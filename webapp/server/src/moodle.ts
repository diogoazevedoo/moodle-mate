// Moodle sync — reads the student's actionable deliverables via Moodle's own
// session AJAX endpoint (/lib/ajax/service.php), reusing the session saved by
// `npm run moodle:login`. The token Web Services API is disabled on this
// instance, but the UI's session-based AJAX (sesskey + cookie) works fine.
//
// This is gentle on purpose: ISTEC's nginx rate-limits (429) aggressive callers.
// We do ONE page fetch (for the sesskey) + ONE AJAX call, with backoff on 429.
import { existsSync, mkdirSync } from "node:fs";
import { type APIRequestContext, request } from "playwright";
import { MOODLE_BASE_URL, STORAGE_STATE_PATH, workspaceFor } from "./config.js";
import {
  addRunEvent, createRun, setRunStatus, upsertCourse, upsertDeliverable,
} from "./db.js";
import { publish } from "./sse.js";
import type { DeliverableType, Run, SseEventType } from "./types.js";

const SYNC_DELIVERABLE_ID = "__sync__"; // sentinel: sync runs aren't tied to one deliverable

// How far back to include (catches recently-overdue items you might still submit)
// and how many events to pull. The dashboard "Todos" filter uses -14 days.
const LOOKBACK_DAYS = 14;
const LIMIT = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emit(runId: string, type: SseEventType, payload: unknown): void {
  publish(runId, addRunEvent(runId, type, payload));
}

interface ActionEvent {
  name?: string;
  activityname?: string;
  activitystr?: string;
  modulename?: string;
  timesort?: number;
  url?: string;
  course?: { id?: number; fullname?: string; shortname?: string; viewurl?: string };
}

/** Start a sync run and fetch in the background; returns the run immediately. */
export async function syncMoodle(): Promise<Run> {
  const cwd = workspaceFor(SYNC_DELIVERABLE_ID);
  mkdirSync(cwd, { recursive: true });
  const run = createRun({ deliverableId: SYNC_DELIVERABLE_ID, kind: "sync", cwd });
  emit(run.id, "run_status", { status: "queued", kind: "sync" });
  void doSync(run).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setRunStatus(run.id, "error", msg);
    emit(run.id, "error", { msg });
  });
  return run;
}

async function doSync(run: Run): Promise<void> {
  if (!existsSync(STORAGE_STATE_PATH)) {
    const msg = "No saved Moodle session. Run `npm run moodle:login` first.";
    setRunStatus(run.id, "error", msg);
    emit(run.id, "error", { msg });
    return;
  }

  setRunStatus(run.id, "running");
  emit(run.id, "run_status", { status: "running" });

  const ctx = await request.newContext({ storageState: STORAGE_STATE_PATH });
  try {
    emit(run.id, "log", { msg: "Reading session…" });
    const sesskey = await getSesskey(ctx);
    if (!sesskey) {
      const msg = "Moodle session expired. Run `npm run moodle:login` again.";
      setRunStatus(run.id, "error", msg);
      emit(run.id, "error", { msg });
      return;
    }

    emit(run.id, "log", { msg: "Fetching deliverables…" });
    const events = await fetchActionEvents(ctx, sesskey, run);

    const courses = new Set<string>();
    let count = 0;
    for (const ev of events) {
      const courseId = ev.course?.id != null ? String(ev.course.id) : "";
      if (!courseId) continue;
      if (!courses.has(courseId)) {
        courses.add(courseId);
        upsertCourse({
          id: courseId,
          shortname: ev.course?.shortname ?? "",
          fullname: ev.course?.fullname ?? ev.course?.shortname ?? `Course ${courseId}`,
          url: ev.course?.viewurl ?? `${MOODLE_BASE_URL}/course/view.php?id=${courseId}`,
        });
      }
      const type: DeliverableType =
        ev.modulename === "quiz" ? "quiz" : ev.modulename === "assign" ? "assignment" : "other";
      upsertDeliverable({
        courseId,
        courseName: ev.course?.fullname ?? ev.course?.shortname ?? `Course ${courseId}`,
        title: (ev.activityname ?? stripPrefix(ev.name) ?? "Untitled").trim(),
        type,
        description: ev.activitystr ?? "",
        dueAt: ev.timesort ? new Date(ev.timesort * 1000).toISOString() : null,
        url: ev.url ?? "",
        status: "pending",
      });
      count += 1;
    }

    emit(run.id, "log", { msg: `Synced ${count} deliverable(s) across ${courses.size} course(s).` });
    emit(run.id, "done", { kind: "sync", deliverables: count, courses: courses.size });
    setRunStatus(run.id, "done");
  } finally {
    await ctx.dispose();
  }
}

/** Read M.cfg.sesskey out of the /my/ page HTML (no browser render needed). */
async function getSesskey(ctx: APIRequestContext): Promise<string | null> {
  const res = await ctx.get(`${MOODLE_BASE_URL}/my/`);
  if (res.status() === 429) {
    await sleep(15000);
    return getSesskey(ctx);
  }
  const html = await res.text();
  return html.match(/"sesskey":"([^"]+)"/)?.[1] ?? null;
}

/** Call core_calendar_get_action_events_by_timesort via the session AJAX endpoint. */
async function fetchActionEvents(
  ctx: APIRequestContext,
  sesskey: string,
  run: Run,
): Promise<ActionEvent[]> {
  const methodname = "core_calendar_get_action_events_by_timesort";
  const timesortfrom = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400;
  const args = { timesortfrom, limitnum: LIMIT, limittononsuspendedevents: true };

  const backoff = [0, 15000, 30000];
  for (let attempt = 0; attempt < backoff.length; attempt++) {
    if (backoff[attempt]) {
      emit(run.id, "log", { msg: `Rate-limited; retrying in ${backoff[attempt] / 1000}s…` });
      await sleep(backoff[attempt]);
    }
    const res = await ctx.post(`${MOODLE_BASE_URL}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`, {
      data: [{ index: 0, methodname, args }],
      headers: { "Content-Type": "application/json" },
    });
    if (res.status() === 429) continue;
    if (!res.ok()) throw new Error(`Moodle AJAX returned ${res.status()}`);
    const body = (await res.json()) as Array<{ error?: boolean; exception?: unknown; data?: { events?: ActionEvent[] } }>;
    const entry = body?.[0];
    if (entry?.error) throw new Error(`Moodle AJAX error: ${JSON.stringify(entry.exception)}`);
    return entry?.data?.events ?? [];
  }
  throw new Error("Moodle rate-limited the request (429) after retries. Try again in a minute.");
}

/** "Termina o prazo de 'X'" / "Fecha 'X'" -> "X" (fallback when activityname missing). */
function stripPrefix(name?: string): string | undefined {
  if (!name) return undefined;
  return name.match(/'([^']+)'/)?.[1] ?? name;
}
