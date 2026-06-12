# <Course full name>

> Copy this folder for each course: `classes/_TEMPLATE/` → `classes/<course-id>/`,
> then fill in the fields below. The `class-context` skill reads this file (plus
> `rubrics/` and `materials/`) so planning and drafting follow YOUR course's
> conventions. Add a matching entry to `classes/_index.json` (see shape below).

## Summary

A short, plain-language description of the course: what it covers, the kind of
work it produces (essays, reports, coding projects, quizzes), and anything the
assistant should always keep in mind (language of submission, formatting house
style, group vs. individual work, etc.).

## Instructor

- **Name:** <instructor name>
- **Contact:** <email / office hours>
- **Notes:** <preferences, e.g. "wants APA 7th", "no AI-generated prose", "strict on word counts">

## Grading

| Component        | Weight | Notes                                  |
|------------------|--------|----------------------------------------|
| Assignments      | 40%    | <e.g. 4 × 10%>                         |
| Project          | 30%    | <coding deliverable; see deliverables/>|
| Final exam/quiz  | 30%    | <on Moodle / in person>                |

> Also record this as `gradingScheme` in `classes/_index.json` (free text is fine).

### Academic integrity

- Does this course use **Turnitin / MOSS** or similar similarity checking? **<yes/no>**
- If yes: the assistant must flag this and keep its output to scaffolding/drafting
  only — final authorship is the student's. (See the safety contract in CLAUDE.md.)

## Key links

- **Moodle course:** <https://moodle.istec-porto.pt/course/view.php?id=...>
- **Syllabus / programme:** <link or `materials/syllabus.pdf`>
- **Submission area:** <Moodle assignment URLs, if stable>

## Where things live

- **Rubrics:** `classes/<course-id>/rubrics/` — grading criteria per deliverable.
- **Materials:** `classes/<course-id>/materials/` — syllabus, notes, readings (gitignored).
- **Deliverables:** `classes/<course-id>/deliverables/` — your scaffolds/notes (gitignored).
  Generated DRAFTS land in `workspace/<deliverableId>/`.

---

## `classes/_index.json` entry shape

`_index.json` maps a **course id** to its metadata. Read it first to resolve a
course. Plain JSON, no comments. Example:

```json
{
  "courses": [
    {
      "id": "12345",
      "name": "Engenharia de Software",
      "shortname": "ES",
      "moodleCourseUrl": "https://moodle.istec-porto.pt/course/view.php?id=12345",
      "term": "2025/2026 S2",
      "gradingScheme": "Assignments 40% / Project 30% / Exam 30%"
    }
  ]
}
```
