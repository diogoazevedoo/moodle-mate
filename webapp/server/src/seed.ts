// Seed the DB with a sample course + deliverables so the dashboard has content
// before the first real Moodle sync. Safe to run repeatedly (upsert by url).
//
//   npm run seed
import { listDeliverables, upsertCourse, upsertDeliverable } from "./db.js";

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

const SAMPLE_COURSE = {
  id: "0000",
  shortname: "DEMO",
  fullname: "Demo Course (sample data)",
  url: "https://moodle.istec-porto.pt/course/view.php?id=0000",
};

upsertCourse(SAMPLE_COURSE);

upsertDeliverable({
  courseId: SAMPLE_COURSE.id,
  courseName: SAMPLE_COURSE.fullname,
  title: "Essay: The impact of automation on software teams",
  type: "assignment",
  description:
    "Write a 1500-word report (APA 7). Sample/demo deliverable — replace with real data via Sync.",
  dueAt: inDays(7),
  url: `${SAMPLE_COURSE.url}#sample-essay`,
  status: "pending",
});

upsertDeliverable({
  courseId: SAMPLE_COURSE.id,
  courseName: SAMPLE_COURSE.fullname,
  title: "Programming project: CLI todo app with tests",
  type: "coding",
  description:
    "Implement a small CLI app with unit tests. Sample/demo deliverable — replace with real data via Sync.",
  dueAt: inDays(14),
  url: `${SAMPLE_COURSE.url}#sample-coding`,
  status: "pending",
});

console.log(`Seeded. Deliverables now in DB: ${listDeliverables().length}`);
