---
name: moodle-platform
description: How moodle-mate reads ISTEC Porto Moodle. Use whenever you need to understand where deliverables, deadlines, and course data come from, why the token API is unavailable, and how the server reads the live site. Read this before reasoning about course/deliverable data.
---

# Moodle platform reference (ISTEC Porto)

Target instance: `https://moodle.istec-porto.pt` (Moodle 4.x, Boost theme, **Portuguese** UI). **Never** drive the Moodle session against any other origin (see CLAUDE.md).

## The token API is disabled — but session AJAX works

The token-based Web Services API is **disabled** on this instance (`login/token.php`
returns `servicenotavailable`). However, Moodle's own web UI calls the same
web-service functions through a **session AJAX endpoint** — `/lib/ajax/service.php`
authenticated by the logged-in cookie + a `sesskey` (no token needed). moodle-mate
uses that, reusing the session saved by `npm run moodle:login` (`.auth/moodle-storage-state.json`).
Credentials never reach the model.

## How the server reads Moodle (not you)

The sync is a deterministic server job in `webapp/server/src/moodle.ts` (triggered by
`POST /api/sync` / the dashboard **Sync Moodle** button). It:
1. fetches `/my/` once to read `sesskey` from the page's `M.cfg`,
2. POSTs to `/lib/ajax/service.php` calling **`core_calendar_get_action_events_by_timesort`**,
   which returns actionable deliverables across all courses as clean JSON.

Each event gives `activityname` (clean title), `modulename` (`assign`→assignment,
`quiz`→quiz), `course.{id,fullname}`, `timesort` (due date), and the activity `url`.
Submitted/non-actionable items drop off automatically, so the list ≈ "what still
needs doing". `LOOKBACK_DAYS` / `LIMIT` constants control the window.

**Rate limiting (important):** ISTEC's nginx returns **429** to rapid callers. Be
gentle — one page fetch + one AJAX call, with backoff. Don't add per-course request
loops without spacing them out.

## When to browse yourself (rare)

Use the Playwright MCP only to open a specific activity page (e.g. to read an
assignment's full instructions/rubric, which the calendar feed doesn't include) —
gently, and only on `https://moodle.istec-porto.pt`.

## Deliverable types & deadlines

Synced events become `deliverable` rows (`DeliverableType` in `types.ts`):
`assignment` (mod_assign — essays, reports, coding; Moodle can't distinguish those,
so the student/draft step decides), `quiz` (plan/remind only — never auto-answer),
`other`. `dueAt` comes from `timesort` (ISO; `null` if none). A missing/ambiguous
deadline should be flagged, never guessed.
