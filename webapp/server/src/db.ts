// SQLite layer (better-sqlite3). Schema + typed helpers used by routes/engine/moodle/seed.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { nanoid } from "nanoid";
import { DATA_DIR } from "./config.js";
import type {
  Approval,
  ApprovalDecision,
  Artifact,
  ArtifactKind,
  Course,
  Deliverable,
  DeliverableStatus,
  Plan,
  PlanStatus,
  Run,
  RunEvent,
  RunKind,
  RunStatus,
  SseEventType,
} from "./types.js";

const DB_PATH = resolve(DATA_DIR, "moodle-mate.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS course (
  id TEXT PRIMARY KEY,
  shortname TEXT NOT NULL,
  fullname TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliverable (
  id TEXT PRIMARY KEY,
  courseId TEXT NOT NULL,
  courseName TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  dueAt TEXT,
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan (
  id TEXT PRIMARY KEY,
  deliverableId TEXT NOT NULL,
  summary TEXT NOT NULL,
  stepsJson TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY,
  deliverableId TEXT NOT NULL,
  planId TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  sessionId TEXT,
  cwd TEXT NOT NULL,
  error TEXT,
  startedAt TEXT NOT NULL,
  endedAt TEXT
);

CREATE TABLE IF NOT EXISTS run_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runId TEXT NOT NULL,
  type TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_event_run ON run_event(runId, id);

CREATE TABLE IF NOT EXISTS approval (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  toolUseId TEXT NOT NULL,
  toolName TEXT NOT NULL,
  inputJson TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  createdAt TEXT NOT NULL,
  decidedAt TEXT
);

CREATE TABLE IF NOT EXISTS artifact (
  id TEXT PRIMARY KEY,
  deliverableId TEXT NOT NULL,
  runId TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${nanoid(12)}`;

// ---- courses ----
export function upsertCourse(c: Course): void {
  db.prepare(
    `INSERT INTO course (id, shortname, fullname, url) VALUES (@id, @shortname, @fullname, @url)
     ON CONFLICT(id) DO UPDATE SET shortname=@shortname, fullname=@fullname, url=@url`,
  ).run(c);
}
export function listCourses(): Course[] {
  return db.prepare(`SELECT * FROM course ORDER BY shortname`).all() as Course[];
}

// ---- deliverables ----
/** Upsert keyed by (courseId, url) when no id is supplied, else by id. */
export function upsertDeliverable(
  d: Omit<Deliverable, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Deliverable {
  const existing = d.id
    ? (db.prepare(`SELECT * FROM deliverable WHERE id=?`).get(d.id) as Deliverable | undefined)
    : (db
        .prepare(`SELECT * FROM deliverable WHERE courseId=? AND url=? AND url<>''`)
        .get(d.courseId, d.url) as Deliverable | undefined);

  const ts = now();
  if (existing) {
    const row: Deliverable = {
      ...existing,
      ...d,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: ts,
    };
    db.prepare(
      `UPDATE deliverable SET courseId=@courseId, courseName=@courseName, title=@title, type=@type,
       description=@description, dueAt=@dueAt, url=@url, status=@status, updatedAt=@updatedAt WHERE id=@id`,
    ).run(row);
    return row;
  }
  const row: Deliverable = {
    id: d.id ?? id("dlv"),
    courseId: d.courseId,
    courseName: d.courseName,
    title: d.title,
    type: d.type,
    description: d.description,
    dueAt: d.dueAt,
    url: d.url,
    status: d.status ?? "pending",
    createdAt: ts,
    updatedAt: ts,
  };
  db.prepare(
    `INSERT INTO deliverable (id, courseId, courseName, title, type, description, dueAt, url, status, createdAt, updatedAt)
     VALUES (@id, @courseId, @courseName, @title, @type, @description, @dueAt, @url, @status, @createdAt, @updatedAt)`,
  ).run(row);
  return row;
}
export function listDeliverables(): Deliverable[] {
  return db
    .prepare(`SELECT * FROM deliverable ORDER BY (dueAt IS NULL), dueAt ASC`)
    .all() as Deliverable[];
}
export function getDeliverable(deliverableId: string): Deliverable | undefined {
  return db.prepare(`SELECT * FROM deliverable WHERE id=?`).get(deliverableId) as
    | Deliverable
    | undefined;
}
export function setDeliverableStatus(deliverableId: string, status: DeliverableStatus): void {
  db.prepare(`UPDATE deliverable SET status=?, updatedAt=? WHERE id=?`).run(
    status,
    now(),
    deliverableId,
  );
}

// ---- plans ----
export function createPlan(deliverableId: string, summary: string, steps: unknown): Plan {
  const row: Plan = {
    id: id("pln"),
    deliverableId,
    summary,
    stepsJson: JSON.stringify(steps ?? []),
    status: "proposed",
    createdAt: now(),
  };
  db.prepare(
    `INSERT INTO plan (id, deliverableId, summary, stepsJson, status, createdAt)
     VALUES (@id, @deliverableId, @summary, @stepsJson, @status, @createdAt)`,
  ).run(row);
  return row;
}
export function getLatestPlan(deliverableId: string): Plan | undefined {
  return db
    .prepare(`SELECT * FROM plan WHERE deliverableId=? ORDER BY createdAt DESC LIMIT 1`)
    .get(deliverableId) as Plan | undefined;
}
export function getPlan(planId: string): Plan | undefined {
  return db.prepare(`SELECT * FROM plan WHERE id=?`).get(planId) as Plan | undefined;
}
export function setPlanStatus(planId: string, status: PlanStatus): void {
  db.prepare(`UPDATE plan SET status=? WHERE id=?`).run(status, planId);
}

// ---- runs ----
export function createRun(input: {
  deliverableId: string;
  planId?: string | null;
  kind: RunKind;
  cwd: string;
}): Run {
  const row: Run = {
    id: id("run"),
    deliverableId: input.deliverableId,
    planId: input.planId ?? null,
    kind: input.kind,
    status: "queued",
    sessionId: null,
    cwd: input.cwd,
    error: null,
    startedAt: now(),
    endedAt: null,
  };
  db.prepare(
    `INSERT INTO run (id, deliverableId, planId, kind, status, sessionId, cwd, error, startedAt, endedAt)
     VALUES (@id, @deliverableId, @planId, @kind, @status, @sessionId, @cwd, @error, @startedAt, @endedAt)`,
  ).run(row);
  return row;
}
export function getRun(runId: string): Run | undefined {
  return db.prepare(`SELECT * FROM run WHERE id=?`).get(runId) as Run | undefined;
}
export function getRunBySession(sessionId: string): Run | undefined {
  return db
    .prepare(`SELECT * FROM run WHERE sessionId=? ORDER BY startedAt DESC LIMIT 1`)
    .get(sessionId) as Run | undefined;
}
export function setRunSession(runId: string, sessionId: string): void {
  db.prepare(`UPDATE run SET sessionId=? WHERE id=?`).run(sessionId, runId);
}
export function setRunStatus(runId: string, status: RunStatus, error?: string | null): void {
  const ended = status === "done" || status === "error" || status === "cancelled" ? now() : null;
  db.prepare(`UPDATE run SET status=?, error=?, endedAt=COALESCE(?, endedAt) WHERE id=?`).run(
    status,
    error ?? null,
    ended,
    runId,
  );
}
export function listRunsForDeliverable(deliverableId: string): Run[] {
  return db
    .prepare(`SELECT * FROM run WHERE deliverableId=? ORDER BY startedAt DESC`)
    .all(deliverableId) as Run[];
}

// ---- run events (also the SSE replay buffer) ----
export function addRunEvent(runId: string, type: SseEventType, payload: unknown): RunEvent {
  const createdAt = now();
  const info = db
    .prepare(`INSERT INTO run_event (runId, type, payloadJson, createdAt) VALUES (?, ?, ?, ?)`)
    .run(runId, type, JSON.stringify(payload ?? {}), createdAt);
  return {
    id: Number(info.lastInsertRowid),
    runId,
    type,
    payloadJson: JSON.stringify(payload ?? {}),
    createdAt,
  };
}
export function listRunEvents(runId: string, afterId = 0): RunEvent[] {
  return db
    .prepare(`SELECT * FROM run_event WHERE runId=? AND id>? ORDER BY id ASC`)
    .all(runId, afterId) as RunEvent[];
}

// ---- approvals ----
export function createApproval(input: {
  runId: string;
  toolUseId: string;
  toolName: string;
  input: unknown;
}): Approval {
  const row: Approval = {
    id: id("apr"),
    runId: input.runId,
    toolUseId: input.toolUseId,
    toolName: input.toolName,
    inputJson: JSON.stringify(input.input ?? {}),
    decision: "pending",
    reason: null,
    createdAt: now(),
    decidedAt: null,
  };
  db.prepare(
    `INSERT INTO approval (id, runId, toolUseId, toolName, inputJson, decision, reason, createdAt, decidedAt)
     VALUES (@id, @runId, @toolUseId, @toolName, @inputJson, @decision, @reason, @createdAt, @decidedAt)`,
  ).run(row);
  return row;
}
export function getApproval(approvalId: string): Approval | undefined {
  return db.prepare(`SELECT * FROM approval WHERE id=?`).get(approvalId) as Approval | undefined;
}
export function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision,
  reason?: string,
): Approval | undefined {
  db.prepare(`UPDATE approval SET decision=?, reason=?, decidedAt=? WHERE id=? AND decision='pending'`).run(
    decision,
    reason ?? null,
    now(),
    approvalId,
  );
  return getApproval(approvalId);
}

// ---- artifacts ----
export function addArtifact(input: {
  deliverableId: string;
  runId: string;
  path: string;
  kind: ArtifactKind;
}): Artifact {
  const row: Artifact = {
    id: id("art"),
    deliverableId: input.deliverableId,
    runId: input.runId,
    path: input.path,
    kind: input.kind,
    createdAt: now(),
  };
  db.prepare(
    `INSERT INTO artifact (id, deliverableId, runId, path, kind, createdAt)
     VALUES (@id, @deliverableId, @runId, @path, @kind, @createdAt)`,
  ).run(row);
  return row;
}
export function listArtifacts(deliverableId: string): Artifact[] {
  return db
    .prepare(`SELECT * FROM artifact WHERE deliverableId=? ORDER BY createdAt DESC`)
    .all(deliverableId) as Artifact[];
}
