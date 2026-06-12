// Typed client for the moodle-mate server API (proxied to :4319 in dev).
// Interfaces mirror webapp/server/src/types.ts (kept minimal on purpose).

export type DeliverableType = "assignment" | "coding" | "quiz" | "other";
export type DeliverableStatus =
  | "pending" | "planned" | "in_review" | "drafting" | "drafted" | "submitted" | "archived";
export type PlanStatus = "proposed" | "approved" | "rejected" | "superseded";
export type RunStatus =
  | "queued" | "running" | "awaiting_approval" | "done" | "error" | "cancelled";

export interface Deliverable {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  type: DeliverableType;
  description: string;
  dueAt: string | null;
  url: string;
  status: DeliverableStatus;
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
  stepsJson: string;
  status: PlanStatus;
  createdAt: string;
}

export interface Run {
  id: string;
  deliverableId: string;
  kind: "sync" | "plan" | "draft";
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
}

export interface Artifact {
  id: string;
  path: string;
  kind: "docx" | "pdf" | "code" | "md";
  createdAt: string;
}

export interface DeliverableListItem extends Deliverable {
  latestPlan: { id: string; status: PlanStatus; summary: string; createdAt: string } | null;
  runSummary: { id: string; kind: string; status: RunStatus; startedAt: string } | null;
  runCount: number;
}

export interface DeliverableDetail {
  deliverable: Deliverable;
  plans: Plan[];
  runs: Run[];
  artifacts: Artifact[];
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body, so bodyless
  // POSTs don't trip Fastify's empty-JSON-body guard.
  const headers = init?.body
    ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
    : init?.headers;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
    throw new Error(`${res.status} ${res.statusText} ${detail}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listDeliverables: () =>
    http<{ deliverables: DeliverableListItem[] }>("/api/deliverables"),
  getDeliverable: (id: string) =>
    http<DeliverableDetail>(`/api/deliverables/${id}`),
  sync: () => http<{ run: Run }>("/api/sync", { method: "POST" }),
  plan: (id: string) =>
    http<{ run: Run }>(`/api/deliverables/${id}/plan`, { method: "POST" }),
  approvePlan: (planId: string) =>
    http<{ plan: Plan }>(`/api/plans/${planId}/approve`, { method: "POST" }),
  rejectPlan: (planId: string) =>
    http<{ plan: Plan }>(`/api/plans/${planId}/reject`, { method: "POST" }),
  draft: (id: string) =>
    http<{ run: Run }>(`/api/deliverables/${id}/draft`, { method: "POST" }),
  cancelRun: (id: string) =>
    http<{ cancelled: boolean }>(`/api/runs/${id}/cancel`, { method: "POST" }),
  resolveApproval: (approvalId: string, decision: "allow" | "deny", reason?: string) =>
    http(`/api/approvals/${approvalId}`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    }),
};

export interface RunStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

const SSE_EVENT_TYPES = [
  "run_status", "assistant_text", "tool_requested", "awaiting_approval",
  "approval_resolved", "tool_result", "artifact", "log", "done",
];

/**
 * Open the SSE stream for a run. Returns the EventSource so the caller can
 * close it. Domain events arrive under their own `event:` name; the shared
 * "error" name is disambiguated from EventSource connection errors by `.data`.
 */
export function openRunStream(runId: string, onEvent: (e: RunStreamEvent) => void): EventSource {
  const es = new EventSource(`/api/runs/${runId}/events`);
  for (const type of SSE_EVENT_TYPES) {
    es.addEventListener(type, (ev) => {
      const me = ev as MessageEvent;
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(me.data); } catch { /* ignore */ }
      onEvent({ type, data });
    });
  }
  es.addEventListener("error", (ev) => {
    const me = ev as MessageEvent;
    if (me && typeof me.data === "string" && me.data) {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(me.data); } catch { /* ignore */ }
      onEvent({ type: "error", data });
    }
    // else: a transient connection error — EventSource auto-reconnects.
  });
  return es;
}
