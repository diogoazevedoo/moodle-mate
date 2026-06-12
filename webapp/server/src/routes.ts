// All HTTP routes under /api (README API table) plus the internal POST
// /hooks/pre-tool approval bridge (long-poll until the student decides).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  addRunEvent, createApproval, getApproval, getDeliverable, getLatestPlan,
  getPlan, getRun, getRunBySession, listArtifacts, listDeliverables, listRunEvents,
  listRunsForDeliverable, resolveApproval, setDeliverableStatus, setPlanStatus,
  setRunStatus,
} from "./db.js";
import { cancelRun, runDraft, runPlan } from "./engine.js";
import { syncMoodle } from "./moodle.js";
import { publish, sseHandler } from "./sse.js";
import type { ApprovalDecision } from "./types.js";

const APPROVAL_POLL_MS = 400;

// In-memory waiters so a resolved approval wakes the holding long-poll at once.
const approvalWaiters = new Map<string, Array<() => void>>();
function notifyApproval(approvalId: string): void {
  const w = approvalWaiters.get(approvalId);
  if (w) { approvalWaiters.delete(approvalId); for (const fn of w) fn(); }
}
function waitForApproval(approvalId: string): Promise<void> {
  return new Promise((resolve) => {
    const arr = approvalWaiters.get(approvalId) ?? [];
    arr.push(resolve); approvalWaiters.set(approvalId, arr);
  });
}

function emit(runId: string, type: Parameters<typeof addRunEvent>[1], payload: unknown): void {
  publish(runId, addRunEvent(runId, type, payload));
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deliverables — list + latest plan + short run summary
  app.get("/api/deliverables", async () => {
    const items = listDeliverables().map((d) => {
      const plan = getLatestPlan(d.id);
      const runs = listRunsForDeliverable(d.id);
      const latestRun = runs[0];
      return {
        ...d,
        latestPlan: plan
          ? { id: plan.id, status: plan.status, summary: plan.summary, createdAt: plan.createdAt }
          : null,
        runSummary: latestRun
          ? { id: latestRun.id, kind: latestRun.kind, status: latestRun.status, startedAt: latestRun.startedAt }
          : null,
        runCount: runs.length,
      };
    });
    return { deliverables: items };
  });

  // GET /api/deliverables/:id — deliverable + plans + runs + artifacts
  app.get<{ Params: { id: string } }>("/api/deliverables/:id", async (req, reply) => {
    const d = getDeliverable(req.params.id);
    if (!d) return reply.code(404).send({ error: "deliverable not found" });
    const plan = getLatestPlan(d.id);
    return {
      deliverable: d,
      plans: plan ? [plan] : [],
      runs: listRunsForDeliverable(d.id),
      artifacts: listArtifacts(d.id),
    };
  });

  // POST /api/sync — start a deterministic Playwright sync (background)
  app.post("/api/sync", async (_req, reply) => {
    const run = await syncMoodle();
    return reply.code(202).send({ run });
  });

  // POST /api/deliverables/:id/plan — start a plan run (Claude)
  app.post<{ Params: { id: string } }>("/api/deliverables/:id/plan", async (req, reply) => {
    const d = getDeliverable(req.params.id);
    if (!d) return reply.code(404).send({ error: "deliverable not found" });
    const run = await runPlan(d.id);
    return reply.code(202).send({ run });
  });

  // POST /api/plans/:id/approve — mark a proposed plan approved (gate for drafting)
  app.post<{ Params: { id: string } }>("/api/plans/:id/approve", async (req, reply) => {
    const plan = getPlan(req.params.id);
    if (!plan) return reply.code(404).send({ error: "plan not found" });
    setPlanStatus(plan.id, "approved");
    setDeliverableStatus(plan.deliverableId, "in_review");
    return { plan: getPlan(plan.id) };
  });

  // POST /api/plans/:id/reject — mark a plan rejected
  app.post<{ Params: { id: string } }>("/api/plans/:id/reject", async (req, reply) => {
    const plan = getPlan(req.params.id);
    if (!plan) return reply.code(404).send({ error: "plan not found" });
    setPlanStatus(plan.id, "rejected");
    return { plan: getPlan(plan.id) };
  });

  // POST /api/deliverables/:id/draft — requires an approved plan
  app.post<{ Params: { id: string } }>("/api/deliverables/:id/draft", async (req, reply) => {
    const d = getDeliverable(req.params.id);
    if (!d) return reply.code(404).send({ error: "deliverable not found" });
    const plan = getLatestPlan(d.id);
    if (!plan || plan.status !== "approved")
      return reply.code(409).send({ error: "an approved plan is required before drafting" });
    const run = await runDraft(d.id);
    return reply.code(202).send({ run });
  });

  // GET /api/runs/:id — run detail + events
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const run = getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: "run not found" });
    return { run, events: listRunEvents(run.id) };
  });

  // GET /api/runs/:id/events — SSE (supports Last-Event-ID)
  app.get<{ Params: { id: string } }>("/api/runs/:id/events", (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const run = getRun(req.params.id);
    if (!run) { reply.code(404).send({ error: "run not found" }); return; }
    sseHandler(req, reply, run.id);
  });

  // POST /api/runs/:id/cancel
  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (req, reply) => {
    const run = getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: "run not found" });
    const cancelled = cancelRun(run.id);
    return { cancelled };
  });

  // POST /api/approvals/:id — { decision, reason? }
  app.post<{ Params: { id: string }; Body: { decision: ApprovalDecision; reason?: string } }>(
    "/api/approvals/:id",
    async (req, reply) => {
      const { decision, reason } = req.body ?? ({} as { decision?: ApprovalDecision; reason?: string });
      if (decision !== "allow" && decision !== "deny")
        return reply.code(400).send({ error: "decision must be 'allow' or 'deny'" });
      const existing = getApproval(req.params.id);
      if (!existing) return reply.code(404).send({ error: "approval not found" });
      const resolved = resolveApproval(req.params.id, decision, reason);
      notifyApproval(req.params.id); // wake the holding /hooks/pre-tool long-poll
      return { approval: resolved };
    },
  );

  // POST /hooks/pre-tool — internal: called by the PreToolUse hook; holds open
  app.post<{ Body: { sessionId: string; toolName: string; toolInput: unknown } }>(
    "/hooks/pre-tool",
    async (req, reply) => {
      const { sessionId, toolName, toolInput } = req.body ?? ({} as { sessionId?: string; toolName?: string; toolInput?: unknown });
      if (!sessionId || !toolName) return reply.send({ decision: "allow" });

      const run = getRunBySession(sessionId);
      if (!run) return reply.send({ decision: "allow" }); // cannot gate an unknown session

      const approval = createApproval({
        runId: run.id,
        toolUseId: `${sessionId}:${Date.now()}`,
        toolName,
        input: toolInput,
      });
      setRunStatus(run.id, "awaiting_approval");
      emit(run.id, "awaiting_approval", { approvalId: approval.id, toolName, toolInput });

      // Long-poll: wake on the in-memory waiter, fall back to a ~400ms poll.
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; clearInterval(timer); resolve(); } };
        const timer = setInterval(() => {
          const a = getApproval(approval.id);
          if (a && (a.decision === "allow" || a.decision === "deny")) finish();
        }, APPROVAL_POLL_MS);
        void waitForApproval(approval.id).then(finish);
      });

      const finalApproval = getApproval(approval.id);
      const decision: ApprovalDecision = finalApproval?.decision === "allow" ? "allow" : "deny";
      const reason = finalApproval?.reason ?? undefined;

      emit(run.id, "approval_resolved", { approvalId: approval.id, decision });
      setRunStatus(run.id, "running");
      return reply.send({ decision, reason });
    },
  );
}
