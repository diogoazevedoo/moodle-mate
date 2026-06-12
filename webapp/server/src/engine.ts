// Engine: drives the Claude Code CLI (`claude -p`) as a subprocess for the two
// model jobs — PLAN and DRAFT. Billing is on a Max/Pro subscription, so we use
// the CLI rather than the in-process Agent SDK (which expects an API key).
//
// Approval gating: we attach a PreToolUse hook ONLY to this subprocess via
// `--settings` (pointing at hooks/engine-approval.mjs). The project's own
// .claude/settings.json stays hook-free so normal dev sessions are never gated.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { CLAUDE_BIN, MOODLE_BASE_URL, PROJECT_ROOT, workspaceFor } from "./config.js";
import {
  addArtifact, addRunEvent, createPlan, createRun, getDeliverable, getLatestPlan,
  setDeliverableStatus, setRunSession, setRunStatus,
} from "./db.js";
import { publish } from "./sse.js";
import type { ArtifactKind, Deliverable, PlanStep, Run, SseEventType } from "./types.js";

const MM_SERVER_URL = "http://127.0.0.1:4319";
const live = new Map<string, ChildProcess>();

// Hook settings injected into the subprocess only (not the project settings).
const ENGINE_APPROVAL_HOOK = resolve(PROJECT_ROOT, "hooks/engine-approval.mjs");
const ENGINE_SETTINGS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: "Write|Edit|MultiEdit|Bash",
        hooks: [{ type: "command", command: `node "${ENGINE_APPROVAL_HOOK}"` }],
      },
    ],
  },
});

function emit(runId: string, type: SseEventType, payload: unknown): void {
  publish(runId, addRunEvent(runId, type, payload));
}

export function extractLastJsonBlock(text: string): unknown | null {
  if (!text) return null;
  const fence = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = fence.exec(text)) !== null) last = match[1];
  if (last === null) return null;
  try { return JSON.parse(last.trim()); } catch { return null; }
}

function fmtDeliverable(d: Deliverable): string {
  return [
    `- title: ${d.title}`, `- type: ${d.type}`,
    `- course: ${d.courseName} (courseId ${d.courseId})`,
    `- description: ${d.description || "(none provided)"}`,
    `- dueAt: ${d.dueAt ?? "(no due date)"}`, `- url: ${d.url || "(none)"}`,
  ].join("\n");
}

function planPrompt(d: Deliverable): string {
  return `You are moodle-mate's PLANNER for a university student.

Your job: produce a concise, ordered plan for the following Moodle deliverable.
Do NOT write any files. Use the Read, Glob, and Grep tools to inspect context —
do NOT use Bash/Write/Edit (they pause for the student's approval and aren't
needed to plan). This is planning only.

Deliverable:
${fmtDeliverable(d)}

Context to read (the working directory is the project root):
- Read classes/_index.json to resolve which class folder this course maps to.
- If a matching classes/<course>/ folder exists, read its class.md and any rubrics/.

Follow the safety contract in CLAUDE.md: drafting copilot, the student owns and
submits the final work, only ever operate on ${MOODLE_BASE_URL}.

End your reply with EXACTLY ONE fenced json block (and nothing after it):
\`\`\`json
{"summary":"...","steps":[{"title":"...","detail":"...","estimateMinutes":30}]}
\`\`\``;
}

function draftPrompt(d: Deliverable, steps: PlanStep[]): string {
  const workspace = workspaceFor(d.id);
  const stepsText = steps.length
    ? steps.map((s, i) => `  ${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ""}${s.estimateMinutes ? ` (~${s.estimateMinutes}m)` : ""}`).join("\n")
    : "  (no explicit steps were provided; use your best judgement)";
  return `You are moodle-mate's DRAFTER for a university student.

Your job: produce a REVIEWABLE DRAFT for the following deliverable, writing files
ONLY inside this directory (absolute path):
  ${workspace}

Deliverable:
${fmtDeliverable(d)}

Approved plan steps:
${stepsText}

Rules (CLAUDE.md — non-negotiable):
- This is a DRAFT the student must review, edit, and own. Label it DRAFT; cite
  sources. NEVER submit/upload to Moodle. Only operate on ${MOODLE_BASE_URL}.
- To inspect files/context use the Read, Glob, and Grep tools — NOT Bash
  (ls/cat/find), which pauses for the student's approval. Reserve Bash for running
  builds, tests, or packaging. Each Write/Edit/Bash pauses for approval — expected.

Output guidance:
- Documents: write markdown into ${workspace}/draft.md. scripts/build-deliverable.sh
  converts markdown to docx/pdf afterwards.
- Coding tasks: scaffold code + tests under ${workspace}/.

End your reply with EXACTLY ONE fenced json block (and nothing after it):
\`\`\`json
{"artifacts":[{"path":"workspace/${d.id}/draft.md","kind":"md"}]}
\`\`\``;
}

function assistantTextFromMessage(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content)
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const t = (block as { text?: unknown }).text;
      if (typeof t === "string") parts.push(t);
    }
  return parts.join("");
}

function toolUsesFromMessage(msg: unknown): Array<{ name: string; input: unknown }> {
  if (!msg || typeof msg !== "object") return [];
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const uses: Array<{ name: string; input: unknown }> = [];
  for (const block of content)
    if (block && typeof block === "object" && (block as { type?: string }).type === "tool_use") {
      const b = block as { name?: unknown; input?: unknown };
      uses.push({ name: typeof b.name === "string" ? b.name : "unknown", input: b.input ?? {} });
    }
  return uses;
}

function isArtifactKind(k: unknown): k is ArtifactKind {
  return k === "docx" || k === "pdf" || k === "code" || k === "md";
}

type RunKindLocal = "plan" | "draft";

function buildArgs(prompt: string): string[] {
  // TODO: verify against the live Claude CLI whether a PreToolUse "allow" is
  // enough to let Write/Edit/Bash run under `claude -p`. If still blocked, add
  // "--permission-mode","acceptEdits" or an explicit "--allowedTools" list here.
  // TODO: verify `--settings` accepts an inline JSON string on the installed
  // version; if it requires a file, write ENGINE_SETTINGS to a temp file first.
  return [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "default",
    "--settings", ENGINE_SETTINGS,
  ];
}

function startSubprocess(run: Run, kind: RunKindLocal, prompt: string): void {
  let child: ChildProcess;
  try {
    child = spawn(CLAUDE_BIN, buildArgs(prompt), {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MM_SERVER_URL },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setRunStatus(run.id, "error", msg); emit(run.id, "error", { msg }); return;
  }
  live.set(run.id, child);
  let finalText = ""; let sawResult = false;
  child.stdout?.setEncoding("utf8");
  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj: unknown;
    try { obj = JSON.parse(trimmed); } catch { emit(run.id, "log", { line: trimmed }); return; }
    handleMessage(run, obj, { onFinalText: (t) => { finalText = t; sawResult = true; } });
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    const text = String(chunk).trim(); if (text) emit(run.id, "log", { stderr: text });
  });
  child.on("error", (err: Error) => {
    live.delete(run.id); setRunStatus(run.id, "error", err.message); emit(run.id, "error", { msg: err.message });
  });
  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    rl.close(); live.delete(run.id);
    if (signal === "SIGTERM" || signal === "SIGKILL") return;
    if (code !== 0 && code !== null) {
      const msg = `claude exited with code ${code}`; setRunStatus(run.id, "error", msg); emit(run.id, "error", { msg }); return;
    }
    void finalize(run, kind, finalText, sawResult).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setRunStatus(run.id, "error", msg); emit(run.id, "error", { msg });
    });
  });
}

interface HandleHooks { onFinalText: (text: string) => void; }

function handleMessage(run: Run, obj: unknown, hooks: HandleHooks): void {
  if (!obj || typeof obj !== "object") return;
  const type = (obj as { type?: unknown }).type;
  if (type === "system") {
    if ((obj as { subtype?: unknown }).subtype === "init") {
      const sessionId = (obj as { session_id?: unknown }).session_id;
      if (typeof sessionId === "string" && sessionId) setRunSession(run.id, sessionId);
      setRunStatus(run.id, "running");
      emit(run.id, "run_status", { status: "running", sessionId: sessionId ?? null });
    }
    return;
  }
  if (type === "assistant") {
    const message = (obj as { message?: unknown }).message;
    const text = assistantTextFromMessage(message);
    if (text) emit(run.id, "assistant_text", { text });
    for (const use of toolUsesFromMessage(message))
      emit(run.id, "tool_requested", { name: use.name, input: use.input });
    return;
  }
  if (type === "user") {
    const message = (obj as { message?: unknown }).message;
    const content = (message as { content?: unknown } | undefined)?.content;
    if (Array.isArray(content))
      for (const block of content)
        if (block && typeof block === "object" && (block as { type?: string }).type === "tool_result")
          emit(run.id, "tool_result", { result: block });
    return;
  }
  if (type === "result") {
    const result = (obj as { result?: unknown }).result;
    if (typeof result === "string") hooks.onFinalText(result);
    else {
      const sub = (obj as { subtype?: unknown }).subtype;
      if (typeof sub === "string" && sub !== "success") emit(run.id, "log", { result: obj });
    }
    return;
  }
}

async function finalize(run: Run, kind: RunKindLocal, finalText: string, sawResult: boolean): Promise<void> {
  const parsed = sawResult ? extractLastJsonBlock(finalText) : null;
  if (kind === "plan") {
    if (parsed && typeof parsed === "object") {
      const p = parsed as { summary?: unknown; steps?: unknown };
      const summary = typeof p.summary === "string" ? p.summary : "";
      const steps: PlanStep[] = Array.isArray(p.steps)
        ? (p.steps as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === "object").map((s) => {
            const step: PlanStep = { title: typeof s.title === "string" ? s.title : "Untitled step" };
            if (typeof s.detail === "string") step.detail = s.detail;
            if (typeof s.estimateMinutes === "number") step.estimateMinutes = s.estimateMinutes;
            return step;
          })
        : [];
      const plan = createPlan(run.deliverableId, summary, steps);
      setDeliverableStatus(run.deliverableId, "planned");
      emit(run.id, "log", { plan: { id: plan.id, summary, stepCount: steps.length } });
    } else emit(run.id, "log", { warning: "No parseable ```json plan block in the model's final reply." });
  } else {
    if (parsed && typeof parsed === "object") {
      const artifacts = (parsed as { artifacts?: unknown }).artifacts;
      if (Array.isArray(artifacts))
        for (const a of artifacts) {
          if (!a || typeof a !== "object") continue;
          const path = (a as { path?: unknown }).path;
          const kindVal = (a as { kind?: unknown }).kind;
          if (typeof path === "string" && path) {
            const artifactKind: ArtifactKind = isArtifactKind(kindVal) ? kindVal : "md";
            const artifact = addArtifact({ deliverableId: run.deliverableId, runId: run.id, path, kind: artifactKind });
            emit(run.id, "artifact", { id: artifact.id, path: artifact.path, kind: artifact.kind });
          }
        }
    } else emit(run.id, "log", { warning: "No parseable ```json artifacts block in the model's final reply." });
    setDeliverableStatus(run.deliverableId, "drafted");
  }
  emit(run.id, "done", { kind });
  setRunStatus(run.id, "done");
}

export async function runPlan(deliverableId: string): Promise<Run> {
  const deliverable = getDeliverable(deliverableId);
  if (!deliverable) throw new Error(`deliverable not found: ${deliverableId}`);
  const cwd = workspaceFor(deliverableId); mkdirSync(cwd, { recursive: true });
  const run = createRun({ deliverableId, kind: "plan", cwd });
  emit(run.id, "run_status", { status: "queued", kind: "plan" });
  startSubprocess(run, "plan", planPrompt(deliverable));
  return run;
}

export async function runDraft(deliverableId: string): Promise<Run> {
  const deliverable = getDeliverable(deliverableId);
  if (!deliverable) throw new Error(`deliverable not found: ${deliverableId}`);
  const plan = getLatestPlan(deliverableId);
  const steps: PlanStep[] = plan ? safeParseSteps(plan.stepsJson) : [];
  const cwd = workspaceFor(deliverableId); mkdirSync(cwd, { recursive: true });
  const run = createRun({ deliverableId, planId: plan?.id ?? null, kind: "draft", cwd });
  setDeliverableStatus(deliverableId, "drafting");
  emit(run.id, "run_status", { status: "queued", kind: "draft" });
  startSubprocess(run, "draft", draftPrompt(deliverable, steps));
  return run;
}

function safeParseSteps(stepsJson: string): PlanStep[] {
  try { const parsed = JSON.parse(stepsJson); return Array.isArray(parsed) ? (parsed as PlanStep[]) : []; }
  catch { return []; }
}

export function cancelRun(runId: string): boolean {
  const child = live.get(runId);
  if (!child) return false;
  live.delete(runId); child.kill("SIGTERM");
  setRunStatus(runId, "cancelled");
  emit(runId, "run_status", { status: "cancelled" });
  emit(runId, "log", { msg: "Run cancelled by user." });
  return true;
}
