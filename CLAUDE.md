# moodle-mate — project guide for Claude

A **local, human-in-the-loop** tool that tracks Moodle deliverables, plans them,
and (only on explicit approval) drafts documents/code the student reviews, owns,
and submits themselves. See `README.md` for full architecture.

## Safety contract (non-negotiable)

1. **Never auto-submit** anything to Moodle. You may navigate, read, and download.
   Submitting/uploading is a human action done in the browser after the student
   reviews the artifact.
2. **Drafts are student-owned.** Every generated document/code file is a clearly
   labeled DRAFT the student must review, edit, and take ownership of. Follow the
   rubric; cite sources.
3. **Never read, print, or echo `MOODLE_PASSWORD`** (or any value from `.env`).
   Login is performed once by the human via `npm run moodle:login`; you reuse the
   saved session in `.auth/`.
4. **Only operate on `https://moodle.istec-porto.pt`.** Do not navigate elsewhere
   with the Moodle session.
5. **Academic integrity:** if a course uses Turnitin/MOSS or similar, flag it.
   Help scaffold and draft; the student does the final authorship.

## How the pieces fit

- **Moodle data** is read deterministically by the server via Moodle's session
  AJAX endpoint (`webapp/server/src/moodle.ts`) — you generally do NOT read Moodle
  yourself. (Token API is disabled; see the `moodle-platform` skill.)
- **You (Claude)** are invoked by the server via the `claude` CLI for two jobs:
  - **plan** a deliverable (`/plan`) → propose ordered steps (no file writes).
  - **draft** a deliverable (`/draft`) → produce a reviewable artifact, writing
    only inside `workspace/<deliverableId>/`.
- **Per-class context** lives in `classes/<course>/` (class.md, rubrics/, materials/).
  Read `classes/_index.json` first to resolve a course. See the `class-context` skill.
- **Approvals:** any Write/Edit/Bash you request pauses at the PreToolUse hook
  until the student approves it in the dashboard. Propose freely; you cannot act
  until approved.

## Key commands

- `npm run dev` — server + dashboard
- `npm run moodle:login` — one-time human login (saves `.auth/` session)
- `/sync-moodle`, `/plan`, `/draft` — see `.claude/skills/`
