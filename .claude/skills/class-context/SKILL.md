---
name: class-context
description: How to locate and load per-class context (syllabus, rubrics, grading weights, materials) before planning or drafting. Use whenever a task references a specific course or deliverable and you need that course's conventions.
---

# Class context retrieval

Per-class knowledge lives under `classes/<course-id>/` (outside `.claude/`, so the
web app and the student can read it too). Always resolve context this way before
planning or drafting:

1. **Read `classes/_index.json`** — maps a course id to `{name, shortname,
   moodleCourseUrl, term, gradingScheme}`. Use it to find the right folder.
2. **Read `classes/<course-id>/class.md`** — summary, instructor preferences,
   grading weights, key links, and whether Turnitin/MOSS is used.
3. **Read the relevant `rubrics/<deliverable>.md`** — grading criteria the
   planner/writer must follow precisely.
4. **Glob `classes/<course-id>/materials/`** for supporting files (syllabus,
   slides, provided code, datasets). Read large files on demand, not eagerly.

Notes:
- A course folder may not exist yet (scaffold/v0). Degrade gracefully: plan/draft
  from the deliverable's own brief and flag that class context is missing so the
  student can add a `class.md` (copy `classes/_TEMPLATE/`).
- Keep machine state (`data/`, `workspace/`) separate from human-authored class
  context (`classes/`). Never put secrets in `classes/`.
