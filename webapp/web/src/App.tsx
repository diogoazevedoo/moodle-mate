import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, openRunStream,
  type DeliverableDetail, type DeliverableListItem, type PlanStep, type RunStreamEvent,
} from "./api.js";

interface PendingApproval {
  approvalId: string;
  toolName: string;
  toolInput: unknown;
}

interface LoggedEvent extends RunStreamEvent {
  seq: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "no due date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function parseSteps(stepsJson: string): PlanStep[] {
  try {
    const v = JSON.parse(stepsJson);
    return Array.isArray(v) ? (v as PlanStep[]) : [];
  } catch {
    return [];
  }
}

export function App() {
  const [items, setItems] = useState<DeliverableListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliverableDetail | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const { deliverables } = await api.listDeliverables();
      setItems(deliverables);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api.getDeliverable(id));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const finishRun = useCallback(async () => {
    esRef.current?.close();
    esRef.current = null;
    await refresh();
    if (selectedId) await loadDetail(selectedId);
  }, [refresh, loadDetail, selectedId]);

  const startStream = useCallback((runId: string) => {
    esRef.current?.close();
    seqRef.current = 0;
    setEvents([]);
    setPending(null);
    setActiveRunId(runId);
    esRef.current = openRunStream(runId, (ev) => {
      setEvents((prev) => [...prev, { ...ev, seq: seqRef.current++ }]);
      if (ev.type === "awaiting_approval") {
        setPending({
          approvalId: String(ev.data.approvalId ?? ""),
          toolName: String(ev.data.toolName ?? "tool"),
          toolInput: ev.data.toolInput,
        });
      } else if (ev.type === "approval_resolved") {
        setPending(null);
      } else if (ev.type === "done" || ev.type === "error") {
        void finishRun();
      }
    });
  }, [finishRun]);

  useEffect(() => () => { esRef.current?.close(); }, []);

  const select = async (id: string) => {
    setSelectedId(id);
    await loadDetail(id);
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const onSync = () => guard(async () => {
    const { run } = await api.sync();
    startStream(run.id);
  });

  const onPlan = () => selectedId && guard(async () => {
    const { run } = await api.plan(selectedId);
    startStream(run.id);
  });

  const onDraft = () => selectedId && guard(async () => {
    const { run } = await api.draft(selectedId);
    startStream(run.id);
  });

  const onApprovePlan = (planId: string) => guard(async () => {
    await api.approvePlan(planId);
    if (selectedId) await loadDetail(selectedId);
    await refresh();
  });

  const onRejectPlan = (planId: string) => guard(async () => {
    await api.rejectPlan(planId);
    if (selectedId) await loadDetail(selectedId);
  });

  const onApproval = (decision: "allow" | "deny") => {
    if (!pending) return;
    void guard(async () => { await api.resolveApproval(pending.approvalId, decision); });
    setPending(null);
  };

  const onCancel = () => activeRunId && guard(async () => { await api.cancelRun(activeRunId); });

  const plan = detail?.plans[0] ?? null;
  const planSteps = plan ? parseSteps(plan.stepsJson) : [];
  const canDraft = plan?.status === "approved";

  return (
    <div className="app">
      <header className="topbar">
        <h1>moodle-mate</h1>
        <div className="spacer" />
        <button className="btn primary" disabled={busy} onClick={onSync}>Sync Moodle</button>
      </header>

      {error && <div className="banner error">{error}<button onClick={() => setError(null)}>×</button></div>}

      <div className="layout">
        <aside className="list">
          {items.length === 0 && <p className="muted">No deliverables yet. Click <b>Sync Moodle</b> (or run <code>npm run seed</code>).</p>}
          {items.filter((d) => d.id !== "__sync__").map((d) => (
            <button
              key={d.id}
              className={`card ${selectedId === d.id ? "selected" : ""}`}
              onClick={() => void select(d.id)}
            >
              <div className="row">
                <span className="course">{d.courseName}</span>
                <span className={`badge type-${d.type}`}>{d.type}</span>
              </div>
              <div className="title">{d.title}</div>
              <div className="row sub">
                <span className="due">⏰ {fmtDate(d.dueAt)}</span>
                <span className={`badge status-${d.status}`}>{d.status}</span>
              </div>
            </button>
          ))}
        </aside>

        <main className="detail">
          {!detail && <p className="muted">Select a deliverable to see its plan and draft it.</p>}
          {detail && (
            <>
              <h2>{detail.deliverable.title}</h2>
              <p className="meta">
                {detail.deliverable.courseName} · <span className={`badge type-${detail.deliverable.type}`}>{detail.deliverable.type}</span>
                {" · "}⏰ {fmtDate(detail.deliverable.dueAt)} · <span className={`badge status-${detail.deliverable.status}`}>{detail.deliverable.status}</span>
              </p>
              {detail.deliverable.description && <p className="desc">{detail.deliverable.description}</p>}
              {detail.deliverable.url && (
                <p><a href={detail.deliverable.url} target="_blank" rel="noreferrer">Open in Moodle ↗</a></p>
              )}

              <div className="actions">
                <button className="btn" disabled={busy} onClick={onPlan}>Plan</button>
                <button className="btn" disabled={busy || !canDraft} title={canDraft ? "" : "Approve a plan first"} onClick={onDraft}>Draft</button>
              </div>

              {plan && (
                <section className="plan">
                  <h3>Plan <span className={`badge plan-${plan.status}`}>{plan.status}</span></h3>
                  <p>{plan.summary}</p>
                  <ol>
                    {planSteps.map((s, i) => (
                      <li key={i}>
                        <b>{s.title}</b>{s.estimateMinutes ? ` (~${s.estimateMinutes}m)` : ""}
                        {s.detail && <div className="muted">{s.detail}</div>}
                      </li>
                    ))}
                  </ol>
                  {plan.status === "proposed" && (
                    <div className="actions">
                      <button className="btn primary" disabled={busy} onClick={() => onApprovePlan(plan.id)}>Approve plan</button>
                      <button className="btn" disabled={busy} onClick={() => onRejectPlan(plan.id)}>Reject</button>
                    </div>
                  )}
                </section>
              )}

              {detail.artifacts.length > 0 && (
                <section className="artifacts">
                  <h3>Artifacts</h3>
                  <ul>
                    {detail.artifacts.map((a) => (
                      <li key={a.id}><span className={`badge type-${a.kind}`}>{a.kind}</span> <code>{a.path}</code></li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {activeRunId && (
            <section className="run">
              <div className="run-head">
                <h3>Run activity</h3>
                <button className="btn small" disabled={busy} onClick={onCancel}>Cancel</button>
              </div>

              {pending && (
                <div className="approval">
                  <div>⚠️ The agent wants to run <b>{pending.toolName}</b>:</div>
                  <pre>{JSON.stringify(pending.toolInput, null, 2)}</pre>
                  <div className="actions">
                    <button className="btn primary" onClick={() => onApproval("allow")}>Approve</button>
                    <button className="btn" onClick={() => onApproval("deny")}>Reject</button>
                  </div>
                </div>
              )}

              <div className="log">
                {events.map((e) => (
                  <div key={e.seq} className={`evt evt-${e.type}`}>
                    <span className="evt-type">{e.type}</span>
                    <span className="evt-data">
                      {e.type === "assistant_text" ? String(e.data.text ?? "") : JSON.stringify(e.data)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
