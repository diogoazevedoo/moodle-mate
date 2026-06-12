---
name: plan-deliverables
description: Turn tracked Moodle deliverables into a prioritized, deadline-aware work plan. Use when the student asks to plan a deliverable, schedule their work, or break an assignment into steps. Read-only — proposes a plan, never writes drafts or touches Moodle.
argument-hint: [deliverable-id | course | this-week]
---

# /plan

Produce an ordered, deadline-aware plan for one (or several) deliverables.

## What to do

1. Resolve context with the `class-context` skill: read `classes/_index.json`,
   then the relevant course's `class.md` (grading weights, effort) and any
   `rubrics/`.
2. Look at the deliverable(s): title, type, due date, instructions.
3. Delegate the reasoning to the **planner** subagent, which returns a concise
   ordered step list (each step: title, optional detail, optional estimate).

## Rules

- **Read-only.** Do not write files, do not submit anything, do not browse
  Moodle. This step only proposes a plan.
- Prioritize by due date and grading weight; flag anything with a missing or
  ambiguous deadline rather than guessing.
- Keep steps small and concrete enough that the student can approve them in the
  dashboard before any drafting happens.

When invoked from the server (the dashboard **Plan** button), the engine ends by
emitting the plan as a single ```json block: `{"summary":"...","steps":[...]}`.
Follow that exact format so the plan is captured.
