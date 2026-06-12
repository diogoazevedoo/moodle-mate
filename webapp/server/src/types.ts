// Shared data model — the single source of truth for DB rows and API payloads.

export type DeliverableType = "assignment" | "coding" | "quiz" | "other";
export type DeliverableStatus =
  | "pending"
  | "planned"
  | "in_review"
  | "drafting"
  | "drafted"
  | "submitted"
  | "archived";

export type PlanStatus = "proposed" | "approved" | "rejected" | "superseded";
export type RunKind = "sync" | "plan" | "draft";
export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "done"
  | "error"
  | "cancelled";
export type ApprovalDecision = "pending" | "allow" | "deny";
export type ArtifactKind = "docx" | "pdf" | "code" | "md";

export type SseEventType =
  | "run_status"
  | "assistant_text"
  | "tool_requested"
  | "awaiting_approval"
  | "approval_resolved"
  | "tool_result"
  | "artifact"
  | "log"
  | "done"
  | "error";

export interface Course {
  id: string; // moodle course id (string)
  shortname: string;
  fullname: string;
  url: string;
}

export interface Deliverable {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  type: DeliverableType;
  description: string;
  dueAt: string | null; // ISO 8601
  url: string;
  status: DeliverableStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PlanStep {
  title: string;
  detail?: string;
  estimateMinutes?: number;
}

export interface Plan {
  id: string;
  deliverableId: string;
  summary: string;
  stepsJson: string; // JSON-encoded PlanStep[]
  status: PlanStatus;
  createdAt: string;
}

export interface Run {
  id: string;
  deliverableId: string;
  planId: string | null;
  kind: RunKind;
  status: RunStatus;
  sessionId: string | null; // claude CLI session id, for resume + hook mapping
  cwd: string;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RunEvent {
  id: number; // autoincrement — doubles as the SSE Last-Event-ID
  runId: string;
  type: SseEventType;
  payloadJson: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  runId: string;
  toolUseId: string;
  toolName: string;
  inputJson: string;
  decision: ApprovalDecision;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface Artifact {
  id: string;
  deliverableId: string;
  runId: string;
  path: string;
  kind: ArtifactKind;
  createdAt: string;
}
