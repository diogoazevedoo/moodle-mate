---
name: draft-code-assignment
description: Scaffold a coding assignment (code + tests) from its brief and an approved plan. Use when the student approves a plan and asks to draft a programming deliverable. Side-effectful — produces reviewable code the student owns; runs tests locally; never submits.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash
argument-hint: <deliverable-id>
---

# /draft (coding)

Scaffold a **reviewable** code solution with tests for a programming deliverable.

## What to do

1. Load the brief + rubric + any provided starter code/materials
   (`class-context`, `materials/`).
2. Delegate to the **code-assignment** subagent. It scaffolds code + tests under
   `workspace/<deliverableId>/` (src/, tests/, README with run instructions).
3. Run the test suite locally and report pass/fail.
4. When ready, package for submission with `scripts/package-code.sh
   workspace/<deliverableId> <assignment-id>` (a single reviewed `.zip`).

## Rules (CLAUDE.md — non-negotiable)

- The output is a **DRAFT the student must review, run, understand, and own.**
- **Never submit/upload to Moodle.** Packaging ≠ submitting.
- Write **only** inside `workspace/<deliverableId>/`.
- Verify the assignment's accepted file types / required layout against the live
  Moodle before packaging (mark assumptions). If the course uses MOSS/plagiarism
  tooling, flag the academic-integrity risk.

The engine ends by emitting `{"artifacts":[{"path":"...","kind":"code"}]}`.
