# moodle-mate

A **local, human-in-the-loop** assistant for university Moodle deliverables.
It tracks your pending works, plans them, and — only on your explicit approval —
drafts documents/code that **you review, own, and submit yourself**. Nothing is
hosted; nothing auto-submits.

> ### 🤖 Built entirely by Claude
> This whole project — the architecture, **every line of code**, the live Moodle
> integration, and its end-to-end verification against a real instance — was
> designed and implemented **autonomously by Claude** (Anthropic's
> [Claude Code](https://claude.com/claude-code), model **Opus 4.8**) in a single
> session. The human's role was limited to: stating the goal, answering a few
> design questions, performing the one-time browser login (so Claude never
> handled the password), and approving actions.
>
> Along the way Claude probed the live Moodle to discover that its token API was
> disabled and pivoted to the session-AJAX approach, chose the stack, wrote the
> server + dashboard + agent skills, **debugged a deadlock it had created itself**
> (a fail-closed approval hook that blocked its own tools), and verified the
> result against the real site. This README, too, was written by Claude.

---

## What it does

1. **Sync** — pulls your current Moodle deliverables (assignments, quizzes) with
   their due dates into a local dashboard.
2. **Plan** — Claude reads a deliverable + your class context and proposes an
   ordered, deadline-aware work plan you review and approve.
3. **Draft** — once you approve a plan, Claude drafts the deliverable
   (essay/report → Word/PDF via pandoc, or code + tests) into a local
   `workspace/` folder. **You review, own, and submit it yourself** — it never
   uploads anything.

It's a **study/productivity copilot with a human in the loop**, not an
auto-submit bot. See [Academic integrity](#security--academic-integrity).

## How it works

```
┌──────────────┐   HTTP/SSE   ┌───────────────────────────┐
│  React/Vite  │ <──────────> │  Fastify (127.0.0.1 only) │
│  dashboard   │              │  + better-sqlite3 + SSE   │
└──────────────┘              └───────────┬───────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
      session AJAX (cookie)       claude CLI subprocess        pandoc / zip
      /lib/ajax/service.php       (agent engine)               doc & code build
      core_calendar_get_          plan + draft, gated by        (scripts/)
      action_events_by_timesort   PreToolUse approval hook
      -> deliverables in DB
```

- **Moodle sync = a deterministic session-AJAX call** (not the model). Moodle's
  own web UI calls web-service functions via `/lib/ajax/service.php` using the
  logged-in cookie + a `sesskey` — no API token required. moodle-mate reuses your
  saved session and calls `core_calendar_get_action_events_by_timesort`, getting
  deliverables as clean JSON. Cheaper and more reliable than scraping HTML.
- **Engine = the `claude` CLI as a subprocess** (`claude -p --output-format
  stream-json`). Plan and draft runs stream live progress to the dashboard.
- **Approvals** are bridged by a **PreToolUse hook** (`hooks/engine-approval.mjs`)
  that long-polls the server until you click Approve/Reject. It's attached **only
  to the engine subprocess** via `claude --settings`, so it never gates normal
  development in the repo.
- **Credentials never touch the model.** You log into Moodle once in a real
  browser window (`npm run moodle:login`); the session is saved locally to
  `.auth/` and reused. The password is only ever typed by you into the browser.

## Prerequisites

- **Node.js ≥ 20** (developed on 24). `better-sqlite3` builds a native module, so
  you need a C toolchain (Xcode Command Line Tools on macOS, `build-essential` on
  Linux).
- **A Moodle account.** Defaults target ISTEC Porto (`moodle.istec-porto.pt`,
  Moodle 4.x) — see [Adapting to your Moodle](#adapting-to-your-moodle).
- **For Plan/Draft only:** the [`claude` CLI](https://claude.com/claude-code) on
  your `PATH`, authenticated (a Claude subscription or an `ANTHROPIC_API_KEY`).
  Sync alone needs no Claude.
- **For rendering documents (optional):** `pandoc` + a LaTeX engine (`xelatex`)
  for `.docx`/`.pdf`, and `zip` for packaging code. Sync/plan don't need these.

## Run it locally

```bash
git clone <this-repo> moodle-mate && cd moodle-mate
npm install                     # installs root + both workspaces
npx playwright install chromium # browser for the one-time login

cp .env.example .env            # set MOODLE_LOGIN_URL, MOODLE_USERNAME (password optional)
npm run moodle:login            # opens a browser — log in BY HAND; saves .auth/ session

npm run dev                     # server :4319 + dashboard :5173  → http://localhost:5173
```

In the dashboard: click **Sync Moodle** → pick a deliverable → **Plan** →
review/approve the plan → **Draft**. The draft lands in `workspace/<id>/`; render
it with `scripts/build-deliverable.sh workspace/<id> both`, then submit it
yourself in Moodle.

> Tip: after `moodle:login` you can delete `MOODLE_PASSWORD` from `.env` — the
> saved session replaces it. `npm run seed` adds sample rows if you want to see
> the UI before connecting a real account.

## Adapting to your Moodle

The host is read from `.env` (`MOODLE_LOGIN_URL` / `MOODLE_BASE_URL`); point it at
your own Moodle 4.x site. The sync relies on Moodle's standard session-AJAX
endpoint and the `core_calendar_get_action_events_by_timesort` function, which is
widely available — but if your institution uses SSO/2FA, disables that endpoint,
or themes things unusually, the login and/or sync may need adjusting. Tunable
knobs live at the top of [`webapp/server/src/moodle.ts`](webapp/server/src/moodle.ts)
(`LOOKBACK_DAYS`, `LIMIT`).

## Repository layout

```
moodle-mate/
├── .claude/                 # the agent "brain": skills, subagents, settings
│   ├── settings.json        # permissions (the approval hook is engine-only, not here)
│   ├── skills/              # moodle-platform, moodle-sync, plan-deliverables,
│   │                        # draft-document, draft-code-assignment, class-context
│   └── agents/              # planner, researcher, writer, code-assignment
├── .mcp.json                # Playwright MCP (optional: lets Claude Code browse Moodle)
├── CLAUDE.md                # always-loaded project facts + safety contract
├── hooks/engine-approval.mjs   # bridges engine tool calls -> dashboard approval
├── classes/                 # per-class context (syllabi, rubrics) — copy _TEMPLATE/
├── scripts/                 # moodle login · build-deliverable (pandoc) · package-code
├── webapp/
│   ├── server/              # Fastify + SQLite + SSE + engine + moodle sync
│   └── web/                 # React + Vite dashboard
├── data/                    # SQLite db + machine state (gitignored)
├── .auth/                   # saved login session (gitignored)
└── workspace/<deliverableId>/  # per-deliverable working dir; drafts land here
```

## Data model (SQLite — source of truth: `webapp/server/src/types.ts`)

- **course**: `id, shortname, fullname, url`
- **deliverable**: `id, courseId, courseName, title, type(assignment|coding|quiz|other),
  description, dueAt(iso|null), url, status(pending|planned|in_review|drafting|drafted|submitted|archived), …`
- **plan**: `id, deliverableId, summary, stepsJson, status(proposed|approved|rejected|superseded), …`
- **run**: `id, deliverableId, planId|null, kind(sync|plan|draft), status(queued|running|awaiting_approval|done|error|cancelled), sessionId, cwd, …`
- **run_event**: `id(autoinc — doubles as SSE Last-Event-ID), runId, type, payloadJson, …`
- **approval**: `id, runId, toolUseId, toolName, inputJson, decision(pending|allow|deny), …`
- **artifact**: `id, deliverableId, runId, path, kind(docx|pdf|code|md), …`

## HTTP API (all under `/api`, bound to 127.0.0.1)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/deliverables`              | list deliverables (+ latest plan/run summary) |
| GET  | `/api/deliverables/:id`          | one deliverable with plans, runs, artifacts |
| POST | `/api/sync`                      | start a Moodle sync run (session AJAX) |
| POST | `/api/deliverables/:id/plan`     | start a **plan** run (Claude) |
| POST | `/api/plans/:id/approve`         | approve a proposed plan (gate for drafting) |
| POST | `/api/deliverables/:id/draft`    | start a **draft** run (Claude); needs an approved plan |
| GET  | `/api/runs/:id/events`           | **SSE** live stream (supports `Last-Event-ID`) |
| POST | `/api/runs/:id/cancel`           | cancel a run |
| POST | `/api/approvals/:id`             | `{ decision: "allow"|"deny", reason? }` |
| POST | `/hooks/pre-tool`                | **internal**: PreToolUse bridge; holds until you decide |

## Security & academic integrity

- `.env`, `.auth/`, `.pw-profile/`, `data/`, `workspace/` are **gitignored** —
  no credentials, sessions, or personal data are committed.
- The model is instructed to never read/echo `MOODLE_PASSWORD` and to operate
  only on the configured Moodle host. Nothing is ever auto-submitted.
- **Academic integrity:** AI-generated text/code can violate course policies,
  especially where Turnitin/MOSS or similar are used. moodle-mate is built as a
  *drafting and planning copilot* with a mandatory human review/ownership step —
  use it to organize, plan, scaffold, and learn, and make the final submitted
  work genuinely your own.

## Status

v0, built and verified in one session. **Verified live**: one-time login → sync →
plan (the `claude -p` engine, inline `--settings`, skills, and plan parsing all
work against the real site). **Not yet exercised end-to-end**: the draft path's
write-gating (a PreToolUse `allow` letting `claude -p` perform a Write through the
dashboard approval) — components are in place; `TODO: verify` markers note the
spots. Moodle DOM/selectors are not used (sync is pure JSON), so there's nothing
theme-specific to maintain there.
