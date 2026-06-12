// Tiny SSE hub: tracks open HTTP responses per runId and fans out RunEvents.
//
// Wire format per event (one SSE frame):
//   id: <event.id>\n
//   event: <event.type>\n
//   data: <event.payloadJson>\n
//   \n
//
// On subscribe we replay any events the client missed (via Last-Event-ID /
// listRunEvents) and then hold the connection open with a periodic comment
// heartbeat (":\n\n") so proxies / browsers don't time the stream out.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerResponse } from "node:http";
import { listRunEvents } from "./db.js";
import type { RunEvent } from "./types.js";

const HEARTBEAT_MS = 15_000;

interface Subscriber {
  runId: string;
  res: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

/** runId -> set of live subscribers. */
const subscribers = new Map<string, Set<Subscriber>>();

function writeEvent(res: ServerResponse, event: RunEvent): void {
  // payloadJson is already JSON; pass it through verbatim.
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${event.payloadJson}\n\n`);
}

/** Push a freshly-recorded RunEvent to every open stream for its run. */
export function publish(runId: string, event: RunEvent): void {
  const set = subscribers.get(runId);
  if (!set || set.size === 0) return;
  for (const sub of set) {
    try {
      writeEvent(sub.res, event);
    } catch {
      // The connection is broken; drop it on the next 'close' cleanup.
    }
  }
}

/** How many live streams are attached to a run (handy for tests/diagnostics). */
export function subscriberCount(runId: string): number {
  return subscribers.get(runId)?.size ?? 0;
}

function parseLastEventId(req: FastifyRequest): number {
  // Browsers resend the last seen id via the Last-Event-ID header on reconnect;
  // also accept it as a query param for manual/curl testing.
  const header = req.headers["last-event-id"];
  const raw = Array.isArray(header) ? header[0] : header;
  const fromQuery =
    typeof req.query === "object" && req.query !== null
      ? (req.query as Record<string, unknown>)["lastEventId"]
      : undefined;
  const candidate = raw ?? (typeof fromQuery === "string" ? fromQuery : undefined);
  const n = Number(candidate);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Fastify route handler for `GET /api/runs/:id/events`.
 * Hijacks the reply, replays missed events, then keeps the socket open.
 */
export function sseHandler(req: FastifyRequest, reply: FastifyReply, runId: string): void {
  // Take over the raw socket — Fastify will not try to send its own response.
  reply.hijack();
  const res = reply.raw;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Prompt the client to reconnect quickly if the stream drops.
  res.write("retry: 3000\n\n");

  // Replay anything the client missed since its Last-Event-ID.
  const lastEventId = parseLastEventId(req);
  for (const event of listRunEvents(runId, lastEventId)) {
    writeEvent(res, event);
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(":\n\n");
    } catch {
      // ignore; cleanup happens on 'close'
    }
  }, HEARTBEAT_MS);
  // Don't let the heartbeat keep the process alive.
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  const sub: Subscriber = { runId, res, heartbeat };
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set<Subscriber>();
    subscribers.set(runId, set);
  }
  set.add(sub);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    const s = subscribers.get(runId);
    if (s) {
      s.delete(sub);
      if (s.size === 0) subscribers.delete(runId);
    }
  };

  res.on("close", cleanup);
  res.on("error", cleanup);
}
