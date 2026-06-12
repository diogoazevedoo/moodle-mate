---
name: moodle-sync
description: Refresh the list of pending Moodle deliverables and deadlines for ISTEC Porto. Use when the student asks to sync, refresh, or pull their latest Moodle assignments/works. Side-effectful — student-triggered only.
disable-model-invocation: true
allowed-tools: Bash(npm run:*), mcp__playwright__*
argument-hint: (no args)
---

# /sync-moodle

Refresh `data/deliverables.json` (the DB) with the student's current Moodle
deliverables and deadlines.

## How sync actually works

The real sync is a **deterministic server-side Playwright job**, not a model
task — it is cheaper and far more reliable than asking the model to browse. It
runs in `webapp/server/src/moodle.ts` and is triggered by `POST /api/sync` (the
dashboard's **Sync Moodle** button). To trigger it from here, ensure the server
is running (`npm run dev`) and use the dashboard, or POST to the endpoint.

It reuses the session saved by `npm run moodle:login` (`.auth/moodle-storage-state.json`).
If that session is missing/expired, sync errors and asks the student to log in
again — **never** ask for or handle the password (see CLAUDE.md).

## When to browse yourself (rare)

Only use the Playwright MCP to **eyeball / verify selectors** when a sync looks
wrong (missing courses, wrong titles, bad dates). The live DOM selectors live in
`webapp/server/src/moodle.ts` and are marked `TODO: verify against the live
Moodle` — correct them there, don't build a parallel scraping path. Only ever
navigate `https://moodle.istec-porto.pt`.

See the `moodle-platform` skill for what data exists and where deadlines live.
