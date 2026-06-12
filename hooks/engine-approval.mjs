#!/usr/bin/env node
// Engine approval bridge — a PreToolUse hook attached ONLY to the server's
// `claude -p` subprocess (via --settings in webapp/server/src/engine.ts), NOT to
// the whole project. It reads the hook payload from stdin, asks the moodle-mate
// server (which surfaces the request to the dashboard for the student to
// approve/reject), and maps the decision back to Claude Code. Fails CLOSED.
const SERVER = process.env.MM_SERVER_URL || "http://127.0.0.1:4319";

function out(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        ...(decision === "deny"
          ? { permissionDecisionReason: reason || "Rejected by user in dashboard" }
          : {}),
      },
    }),
  );
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { /* ignore malformed */ }
  try {
    // The server long-polls and only responds once the student decides.
    const res = await fetch(`${SERVER}/hooks/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: payload.session_id,
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
      }),
    });
    if (!res.ok) return out("deny", `approval server returned ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (body && body.decision === "allow") return out("allow");
    return out("deny", (body && body.reason) || "Rejected by user in dashboard");
  } catch {
    return out("deny", "approval server unreachable");
  }
});
