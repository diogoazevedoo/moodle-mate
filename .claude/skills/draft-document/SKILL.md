---
name: draft-document
description: Draft an essay/report deliverable (Word/PDF) from its brief, rubric, and an approved plan. Use when the student approves a plan and asks to draft a written deliverable. Side-effectful — produces a reviewable DRAFT the student owns; never submits.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Bash(pandoc:*), Bash(scripts/build-deliverable.sh:*)
argument-hint: <deliverable-id>
---

# /draft (documents)

Produce a reviewable **DRAFT** document for a written deliverable.

## What to do

1. Load context: the deliverable's brief, the course's `rubrics/<name>.md`, and
   any sources (see `class-context` and the `researcher` subagent).
2. Delegate writing to the **writer** subagent. It writes `draft.md` into
   `workspace/<deliverableId>/`.
3. Render to a submittable file with `scripts/build-deliverable.sh
   workspace/<deliverableId> both` (→ `out.docx` / `out.pdf`, APA via
   `--citeproc` when a `refs.bib` + `styles/apa.csl` are present).

## Rules (CLAUDE.md — non-negotiable)

- The output is a **DRAFT the student must review, edit, and own.** Label it
  DRAFT; cite sources; follow the rubric (font, spacing, word count, style).
- **Never submit/upload to Moodle.** Submission is a manual human step.
- Write **only** inside `workspace/<deliverableId>/`.
- If the course uses Turnitin/originality checking, flag the academic-integrity
  risk and keep output to scaffolding the student finishes.

The engine ends by emitting `{"artifacts":[{"path":"...","kind":"md|docx|pdf"}]}`.
