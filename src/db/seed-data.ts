import { addDays, addMinutes, dayKey, shiftDay, zonedToUtc } from "@/lib/time";
import { nullifyBadge, grantReattempt } from "@/domain/badges";
import { bookAppointment, cancelAppointment, markAbsence, rescheduleAppointment } from "@/domain/booking";
import { setClockOffsetMs, type Actor } from "@/domain/core";
import { clearSkill } from "@/domain/eligibility";
import { recordOutcome } from "@/domain/outcomes";
import type { Db } from "./index";
import * as s from "./schema";

/**
 * Demo fixtures. Everything here is fictional: surnames describe the state
 * each student demonstrates and all e-mail addresses use the reserved
 * `.example` domain. History is produced by calling the real domain services
 * with past clock values, so seeded data obeys every rule the app enforces
 * and comes with a genuine audit trail.
 */

export const TEAM_ACTOR: Actor = { role: "team", id: "team_ops", name: "Interview Team (demo)" };

const SKILLS = [
  ["skl_html", "html-css", "HTML & CSS"],
  ["skl_js", "javascript", "JavaScript"],
  ["skl_react", "react", "React"],
  ["skl_api", "rest-apis", "REST APIs"],
  ["skl_python", "python", "Python"],
  ["skl_sql", "sql", "SQL"],
  ["skl_stats", "statistics", "Statistics"],
  ["skl_viz", "data-viz", "Data Visualisation"],
  ["skl_prompt", "prompt-design", "Prompt Design"],
] as const;

const BADGES = [
  {
    id: "bdg_fullstack",
    slug: "full-stack-web-novice",
    track: "Full-Stack Web",
    tier: "Novice",
    name: "Full-Stack Web · Novice",
    description: "Build and ship a small web product end to end: markup, interactivity, components and an API.",
    skills: ["skl_html", "skl_js", "skl_react", "skl_api"],
  },
  {
    id: "bdg_data",
    slug: "data-analytics-novice",
    track: "Data Analytics",
    tier: "Novice",
    name: "Data Analytics · Novice",
    description: "Query, analyse and present data to answer a practical question with evidence.",
    skills: ["skl_python", "skl_sql", "skl_stats", "skl_viz"],
  },
  {
    id: "bdg_ai",
    slug: "ai-app-builder-novice",
    track: "AI App Builder",
    tier: "Novice",
    name: "AI App Builder · Novice",
    description: "Prototype a useful AI-assisted feature: prompt design, a Python service and an API around it.",
    skills: ["skl_python", "skl_prompt", "skl_api"],
  },
] as const;

const STUDENTS = [
  ["stu_mira", "Mira Notyet"],
  ["stu_kabir", "Kabir Eligible"],
  ["stu_tara", "Tara Booked"],
  ["stu_dev", "Dev Pending"],
  ["stu_isha", "Isha Passed"],
  ["stu_rohan", "Rohan Failed"],
  ["stu_neha", "Neha Retake"],
  ["stu_arjun", "Arjun Nullified"],
  ["stu_zoya", "Zoya Secondtry"],
  ["stu_sam", "Sam Unbooked"],
  ["stu_lina", "Lina Rescheduled"],
  ["stu_pia", "Pia Noshow"],
  ["stu_omar", "Omar Earlystage"],
] as const;

const INTERVIEWERS = [
  ["int_priya", "Priya Panelist"],
  ["int_vikram", "Vikram Reviewer"],
  ["int_ananya", "Ananya Assessor"],
] as const;

export const DEFAULT_STUDENT_ID = "stu_mira";
export const DEFAULT_INTERVIEWER_ID = "int_priya";

export function wipeAll(db: Db) {
  db.transaction((tx) => {
    for (const t of [
      s.auditEvents,
      s.badgeNullifications,
      s.badgeAwards,
      s.attemptGrants,
      s.attemptOutcomes,
      s.appointments,
      s.interviewAttempts,
      s.availabilityWindows,
      s.badgeEligibilities,
      s.studentSkillCompletions,
      s.badgeSkillRequirements,
      s.interviewers,
      s.trackBadges,
      s.skills,
      s.students,
      s.appMeta,
    ])
      tx.delete(t).run();
  });
}

export function seedDemoData(db: Db, now: Date) {
  const today = dayKey(now);
  /** IST wall-clock instant `offset` days from today. */
  const at = (offset: number, hm: string) => zonedToUtc(shiftDay(today, offset), hm);
  const iso = (d: Date) => d.toISOString();

  db.transaction((tx) => {
    const created = iso(addDays(now, -60));
    tx.insert(s.skills).values(SKILLS.map(([id, code, name]) => ({ id, code, name }))).run();
    for (const b of BADGES) {
      const { skills: req, ...badge } = b;
      tx.insert(s.trackBadges).values({ ...badge, interviewMinutes: 30 }).run();
      tx.insert(s.badgeSkillRequirements).values(req.map((skillId) => ({ badgeId: b.id, skillId }))).run();
    }
    tx.insert(s.students)
      .values(
        STUDENTS.map(([id, name]) => ({
          id,
          name,
          email: `${name.toLowerCase().replace(/\s+/g, ".")}@students.grit-demo.example`,
          cohort: "Demo cohort 2025",
          createdAt: created,
        })),
      )
      .run();
    tx.insert(s.interviewers)
      .values(
        INTERVIEWERS.map(([id, name]) => ({
          id,
          name,
          email: `${name.toLowerCase().replace(/\s+/g, ".")}@interviewers.grit-demo.example`,
        })),
      )
      .run();

    // Recurring availability for yesterday .. +9 days.
    const win = (interviewerId: string, offset: number, from: string, to: string) =>
      tx
        .insert(s.availabilityWindows)
        .values({
          id: `win_${interviewerId.slice(4)}_${shiftDay(today, offset)}_${from.replace(":", "")}`,
          interviewerId,
          startsAt: iso(at(offset, from)),
          endsAt: iso(at(offset, to)),
          createdAt: created,
          updatedAt: created,
        })
        .run();
    for (let d = -1; d <= 9; d++) {
      win("int_priya", d, "10:00", "13:00");
      win("int_priya", d, "15:00", "17:00");
      win("int_vikram", d, "14:00", "18:00");
      if (d % 2 === 0) win("int_ananya", d, "09:00", "12:00");
      else win("int_ananya", d, "16:00", "19:00");
    }
    // One-off windows that hosted historical interviews.
    win("int_vikram", -20, "10:00", "13:00");
    win("int_ananya", -12, "10:00", "13:00");
    win("int_vikram", -6, "10:00", "13:00");
    win("int_priya", -5, "10:00", "13:00");
    win("int_ananya", -3, "10:00", "13:00");
    win("int_ananya", -2, "10:00", "13:00");
  });

  const skillsOf = (badgeId: string) => BADGES.find((b) => b.id === badgeId)!.skills as readonly string[];
  /** Clear skills one per day, the last one at `lastAt` (that is when eligibility is reached). */
  const clear = (studentId: string, skillIds: readonly string[], lastAt: Date) =>
    skillIds.forEach((skillId, i) =>
      clearSkill(db, { studentId, skillId, now: addDays(lastAt, -(skillIds.length - 1 - i) * 4) }),
    );
  const student = (id: string): Actor => ({ role: "student", id, name: STUDENTS.find((x) => x[0] === id)![1] });
  const interviewer = (id: string): Actor => ({
    role: "interviewer",
    id,
    name: INTERVIEWERS.find((x) => x[0] === id)![1],
  });
  const book = (studentId: string, badgeId: string, interviewerId: string, start: Date, bookedAt: Date) =>
    bookAppointment(db, {
      studentId,
      badgeId,
      interviewerId,
      startsAt: iso(start),
      actor: student(studentId),
      now: bookedAt,
    });
  const result = (appointmentId: string, interviewerId: string, start: Date, outcome: s.Outcome, notes: string, wait?: number) =>
    recordOutcome(db, {
      appointmentId,
      outcome,
      privateNotes: notes,
      retakeWaitDays: wait,
      actor: interviewer(interviewerId),
      now: addMinutes(start, 35),
    });

  // 1. Not yet eligible: one skill short of Full-Stack Web.
  clear("stu_mira", ["skl_html", "skl_js", "skl_api"], addDays(now, -9));
  clear("stu_mira", ["skl_python"], addDays(now, -12));

  // 2. Just became eligible, has not booked.
  clear("stu_kabir", skillsOf("bdg_fullstack"), addMinutes(now, -120));

  // 3. Interview booked for tomorrow.
  clear("stu_tara", skillsOf("bdg_fullstack"), addDays(now, -4));
  book("stu_tara", "bdg_fullstack", "int_priya", at(1, "10:30"), addDays(now, -3));

  // 4. Interview happened yesterday; the interviewer has not recorded a result.
  clear("stu_dev", skillsOf("bdg_data"), addDays(now, -6));
  book("stu_dev", "bdg_data", "int_priya", at(-1, "11:00"), addDays(now, -5));

  // 5. Passed -> badge earned.
  clear("stu_isha", skillsOf("bdg_fullstack"), addDays(now, -10));
  clear("stu_isha", ["skl_python", "skl_sql"], addDays(now, -2));
  const isha = book("stu_isha", "bdg_fullstack", "int_vikram", at(-6, "10:30"), addDays(now, -9));
  result(isha.appointmentId, "int_vikram", at(-6, "10:30"), "pass", "Clear walkthrough of the project; solid on API design.");

  // 6. Failed.
  clear("stu_rohan", skillsOf("bdg_fullstack"), addDays(now, -8));
  const rohan = book("stu_rohan", "bdg_fullstack", "int_ananya", at(-3, "11:00"), addDays(now, -7));
  result(rohan.appointmentId, "int_ananya", at(-3, "11:00"), "fail", "Could not explain component state or the API layer of the submitted project.");

  // 7. Retake later (re-booking window already open).
  clear("stu_neha", skillsOf("bdg_data"), addDays(now, -9));
  const neha = book("stu_neha", "bdg_data", "int_priya", at(-5, "10:00"), addDays(now, -8));
  result(neha.appointmentId, "int_priya", at(-5, "10:00"), "retake_later", "Connection dropped twice; not enough signal to decide either way.", 3);

  // 8. Earned the badge, later nullified for malpractice.
  clear("stu_arjun", skillsOf("bdg_fullstack"), addDays(now, -25));
  const arjun = book("stu_arjun", "bdg_fullstack", "int_vikram", at(-20, "10:00"), addDays(now, -24));
  const arjunResult = result(arjun.appointmentId, "int_vikram", at(-20, "10:00"), "pass", "Good answers throughout.");
  nullifyBadge(db, {
    awardId: arjunResult.awardId!,
    reason: "Demo fixture: review of the interview recording confirmed a second person was answering off-camera.",
    actor: TEAM_ACTOR,
    now: addDays(now, -2),
  });

  // 9. Failed attempt 1, team opened a new attempt, attempt 2 is booked.
  clear("stu_zoya", skillsOf("bdg_fullstack"), addDays(now, -16));
  const zoya = book("stu_zoya", "bdg_fullstack", "int_ananya", at(-12, "11:30"), addDays(now, -15));
  result(zoya.appointmentId, "int_ananya", at(-12, "11:30"), "fail", "Struggled with React fundamentals.");
  grantReattempt(db, {
    studentId: "stu_zoya",
    badgeId: "bdg_fullstack",
    reason: "Completed the recommended React revision module (demo fixture).",
    actor: TEAM_ACTOR,
    now: addDays(now, -8),
  });
  book("stu_zoya", "bdg_fullstack", "int_vikram", at(2, "15:00"), addDays(now, -7));

  // 10. Eligible for a while, booked once, cancelled - currently unbooked.
  clear("stu_sam", skillsOf("bdg_ai"), addDays(now, -9));
  const sam = book("stu_sam", "bdg_ai", "int_vikram", at(1, "16:00"), addDays(now, -8));
  cancelAppointment(db, {
    appointmentId: sam.appointmentId,
    reason: "Clashes with a semester exam",
    actor: student("stu_sam"),
    now: addDays(now, -6),
  });

  // 11. Booked, then rescheduled once.
  clear("stu_lina", skillsOf("bdg_data"), addDays(now, -7));
  const lina = book("stu_lina", "bdg_data", "int_priya", at(1, "12:00"), addDays(now, -6));
  rescheduleAppointment(db, {
    appointmentId: lina.appointmentId,
    interviewerId: "int_priya",
    startsAt: iso(at(3, "10:00")),
    actor: student("stu_lina"),
    now: addDays(now, -2),
  });

  // 12. Student no-show: attempt stays open, needs to re-book.
  clear("stu_pia", skillsOf("bdg_ai"), addDays(now, -6));
  const pia = book("stu_pia", "bdg_ai", "int_ananya", at(-2, "10:00"), addDays(now, -5));
  markAbsence(db, {
    appointmentId: pia.appointmentId,
    kind: "no_show",
    note: "Waited 15 minutes; student did not join.",
    actor: interviewer("int_ananya"),
    now: addMinutes(at(-2, "10:00"), 16),
  });

  // 13. Early stage.
  clear("stu_omar", ["skl_js"], addDays(now, -3));

  setClockOffsetMs(db, 0);
}

export function resetDemoData(db: Db) {
  wipeAll(db);
  seedDemoData(db, new Date());
}

/** What the seed is expected to produce; asserted by tests against the dashboard queries. */
export const SEED_EXPECTATIONS = {
  eligible: 11,
  unbooked: 3,
  booked: 3,
  outcomePending: 1,
  completed: 5,
  outcomes: { pass: 2, fail: 2, retake_later: 1 },
  badgesActive: 1,
  badgesNullified: 1,
  noShows: 1,
} as const;
