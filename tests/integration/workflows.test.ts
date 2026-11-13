import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/db";
import * as s from "@/db/schema";
import { SEED_EXPECTATIONS, seedDemoData, resetDemoData } from "@/db/seed-data";
import { createWindow, deleteWindow, updateWindow } from "@/domain/availability";
import { grantReattempt, nullifyBadge } from "@/domain/badges";
import {
  bookAppointment,
  cancelAppointment,
  listOpenSlots,
  markAbsence,
  markConducted,
  rescheduleAppointment,
} from "@/domain/booking";
import { loadBadgeContext } from "@/domain/core";
import { clearSkill } from "@/domain/eligibility";
import { correctOutcome, recordOutcome } from "@/domain/outcomes";
import { getOverview, getRoster, getStudentBadgeView, listAudit } from "@/domain/queries";
import {
  asInterviewer,
  asStudent,
  expectDomainError,
  hours,
  makeEligible,
  makeWorld,
  mins,
  NOW,
  SLOT,
  TEAM,
} from "../helpers";

let db: Db;
beforeEach(async () => {
  db = (await makeWorld());
});

const book = async (studentId = "s1", slot = SLOT(0), interviewerId = "i1", now = NOW, key?: string) =>
  (await bookAppointment(db, {
    studentId,
    badgeId: "badge",
    interviewerId,
    startsAt: slot,
    idempotencyKey: key,
    actor: asStudent(studentId),
    now,
  }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = async (table: any): Promise<unknown[]> => (await db.select().from(table).all());
const appt = async (id: string) => (await db.select().from(s.appointments).where(eq(s.appointments.id, id)).get())!;
const attempt = async (id: string) => (await db.select().from(s.interviewAttempts).where(eq(s.interviewAttempts.id, id)).get())!;
const journey = async (studentId: string, now = NOW) => (await loadBadgeContext(db, studentId, "badge", now)).journey;

describe("eligibility", () => {
  it("unlocks the interview only when the final required skill is cleared", async () => {
    (await clearSkill(db, { studentId: "s1", skillId: "A", now: NOW }));
    expect((await journey("s1"))).toBe("locked");
    (await expectDomainError(async () => (await book()), "NOT_ELIGIBLE"));
    const r = (await clearSkill(db, { studentId: "s1", skillId: "B", now: mins(5) }));
    expect(r.newlyEligibleBadgeIds).toEqual(["badge"]);
    expect((await journey("s1"))).toBe("eligible_unbooked");
    const e = (await db.select().from(s.badgeEligibilities).all());
    expect(e).toHaveLength(1);
    expect(e[0].eligibleAt).toBe(mins(5).toISOString());
  });

  it("is idempotent when a skill completion is delivered twice", async () => {
    (await makeEligible(db, "s1"));
    const again = (await clearSkill(db, { studentId: "s1", skillId: "B", now: hours(1) }));
    expect(again).toEqual({ alreadyCleared: true, newlyEligibleBadgeIds: [] });
    expect((await rows(s.badgeEligibilities))).toHaveLength(1);
    expect((await rows(s.studentSkillCompletions))).toHaveLength(2);
    expect((await listAudit(db)).filter((e) => e.eventType === "eligibility.granted")).toHaveLength(1);
  });
});

describe("slots and booking", () => {
  beforeEach(async () => {
    (await makeEligible(db, "s1"));
    (await makeEligible(db, "s2"));
  });

  it("derives real slots from availability and hides past / too-soon ones", async () => {
    const all = (await listOpenSlots(db, { from: NOW, to: hours(48), now: NOW }));
    expect(all.filter((x) => x.interviewerId === "i1")).toHaveLength(8);
    expect(all.filter((x) => x.interviewerId === "i2")).toHaveLength(2);
    // 09:45 IST: the 10:00 slot is inside the 30-minute lead time.
    const later = (await listOpenSlots(db, { from: NOW, to: hours(48), now: mins(45) }));
    expect(later.some((x) => x.startsAt === SLOT(0))).toBe(false);
    expect(later.some((x) => x.startsAt === SLOT(1))).toBe(true);
  });

  it("books a slot, opens attempt 1 and removes the slot from availability", async () => {
    const r = (await book());
    expect((await appt(r.appointmentId))).toMatchObject({ status: "scheduled", startsAt: SLOT(0), endsAt: SLOT(1) });
    expect((await attempt(r.attemptId))).toMatchObject({ attemptNo: 1, status: "awaiting_interview" });
    expect((await journey("s1"))).toBe("booked");
    const open = (await listOpenSlots(db, { from: NOW, to: hours(48), now: NOW }));
    expect(open.some((x) => x.interviewerId === "i1" && x.startsAt === SLOT(0))).toBe(false);
    expect(open.some((x) => x.interviewerId === "i2" && x.startsAt === SLOT(0))).toBe(true);
  });

  it("never lets two students hold the same slot", async () => {
    (await book("s1"));
    (await expectDomainError(async () => (await book("s2")), "SLOT_TAKEN"));
    expect((await rows(s.appointments))).toHaveLength(1);
    // The failed booking must not leave an orphan attempt behind.
    expect((await rows(s.interviewAttempts))).toHaveLength(1);
  });

  it("enforces the slot rule in the database even if the service check is bypassed", async () => {
    const r = (await book("s1"));
    const a = (await appt(r.appointmentId));
    await expect(db
        .insert(s.appointments)
        .values({ ...a, id: "dup", attemptId: a.attemptId, studentId: "s2", idempotencyKey: null })
        .run()).rejects.toMatchObject({ cause: { extendedCode: "SQLITE_CONSTRAINT_UNIQUE" } });
  });

  it("stops one student holding two active appointments for a badge", async () => {
    (await book("s1", SLOT(0)));
    (await expectDomainError(async () => (await book("s1", SLOT(2))), "ALREADY_BOOKED"));
  });

  it("stops a student double-booking themselves across badges at the same time", async () => {
    (await makeEligible(db, "s1", NOW, "badge2"));
    (await book("s1", SLOT(0), "i1"));
    (await expectDomainError(
      async () =>
        (await bookAppointment(db, {
          studentId: "s1",
          badgeId: "badge2",
          interviewerId: "i2",
          startsAt: SLOT(0),
          actor: asStudent("s1"),
          now: NOW,
        })),
      "STUDENT_CONFLICT",
    ));
  });

  it("returns the original booking when the same submit is replayed", async () => {
    const first = (await book("s1", SLOT(0), "i1", NOW, "key-1"));
    const second = (await book("s1", SLOT(0), "i1", mins(1), "key-1"));
    expect(second).toEqual({ ...first, replayed: true });
    expect((await rows(s.appointments))).toHaveLength(1);
    expect((await listAudit(db)).filter((e) => e.eventType === "appointment.booked")).toHaveLength(1);
  });

  it("rejects past, off-grid, too-soon and unoffered times", async () => {
    (await expectDomainError(async () => (await book("s1", SLOT(0), "i1", hours(3))), "SLOT_IN_PAST"));
    (await expectDomainError(async () => (await book("s1", SLOT(0), "i1", mins(45))), "SLOT_TOO_SOON"));
    (await expectDomainError(async () => (await book("s1", "2026-11-02T04:40:00.000Z")), "SLOT_UNAVAILABLE"));
    (await expectDomainError(async () => (await book("s1", SLOT(10))), "SLOT_UNAVAILABLE"));
    (await expectDomainError(async () => (await book("s1", "tomorrow at ten")), "INVALID_SLOT"));
    (await expectDomainError(async () => (await book("s1", SLOT(3), "i2")), "SLOT_UNAVAILABLE"));
  });

  it("rejects a slot whose availability was removed while the student was choosing", async () => {
    (await deleteWindow(db, { windowId: "w1", actor: asInterviewer("i1"), now: NOW }));
    (await expectDomainError(async () => (await book("s1", SLOT(0))), "SLOT_UNAVAILABLE"));
  });
});

describe("cancel and reschedule", () => {
  beforeEach(async () => (await makeEligible(db, "s1")));

  it("cancelling keeps the row, frees the slot and lets the student re-book on the same attempt", async () => {
    const first = (await book("s1", SLOT(48)));
    (await cancelAppointment(db, { appointmentId: first.appointmentId, reason: "exam", actor: asStudent("s1"), now: hours(1) }));
    expect((await appt(first.appointmentId))).toMatchObject({ status: "cancelled", closedBy: "student", closeReason: "exam" });
    expect((await journey("s1"))).toBe("eligible_unbooked");
    expect((await listOpenSlots(db, { from: NOW, to: hours(48), now: NOW })).some((x) => x.startsAt === SLOT(48))).toBe(true);
    const again = (await book("s1", SLOT(49), "i1", hours(2)));
    expect(again.attemptId).toBe(first.attemptId);
    expect((await attempt(again.attemptId)).attemptNo).toBe(1);
    expect((await rows(s.appointments))).toHaveLength(2);
  });

  it("treats a repeated cancel as a no-op", async () => {
    const r = (await book("s1", SLOT(48)));
    (await cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s1"), now: NOW }));
    expect((await cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s1"), now: NOW }))).toEqual({
      replayed: true,
    });
    expect((await listAudit(db)).filter((e) => e.eventType === "appointment.cancelled")).toHaveLength(1);
  });

  it("closes the student change window 2 hours before the start, but not for the team", async () => {
    const r = (await book("s1", SLOT(4 - 1))); // 11:30 IST today
    const late = mins(60); // 10:00 IST -> 90 minutes before
    (await expectDomainError(
      async () => (await cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s1"), now: late })),
      "CHANGE_WINDOW_CLOSED",
    ));
    (await expectDomainError(
      async () =>
        (await rescheduleAppointment(db, {
          appointmentId: r.appointmentId,
          interviewerId: "i1",
          startsAt: SLOT(48),
          actor: asStudent("s1"),
          now: late,
        })),
      "CHANGE_WINDOW_CLOSED",
    ));
    (await cancelAppointment(db, { appointmentId: r.appointmentId, actor: TEAM, now: late }));
    expect((await appt(r.appointmentId)).status).toBe("cancelled");
  });

  it("does not let a student cancel someone else's interview", async () => {
    const r = (await book("s1", SLOT(48)));
    (await expectDomainError(
      async () => (await cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s2"), now: NOW })),
      "FORBIDDEN",
    ));
  });

  it("rescheduling keeps the original row and links the replacement to it", async () => {
    const first = (await book("s1", SLOT(48)));
    const moved = (await rescheduleAppointment(db, {
      appointmentId: first.appointmentId,
      interviewerId: "i1",
      startsAt: SLOT(50),
      actor: asStudent("s1"),
      now: hours(1),
    }));
    expect((await appt(first.appointmentId)).status).toBe("rescheduled");
    expect((await appt(moved.appointmentId))).toMatchObject({
      status: "scheduled",
      startsAt: SLOT(50),
      rescheduledFromId: first.appointmentId,
      attemptId: first.attemptId,
    });
    const open = (await listOpenSlots(db, { from: NOW, to: hours(48), now: NOW }));
    expect(open.some((x) => x.startsAt === SLOT(48))).toBe(true);
    expect(open.some((x) => x.startsAt === SLOT(50))).toBe(false);
  });

  it("rejects rescheduling to the same slot, a taken slot, and beyond the limit", async () => {
    (await makeEligible(db, "s2"));
    const mine = (await book("s1", SLOT(48)));
    (await book("s2", SLOT(49)));
    const move = async (slot: string, id = mine.appointmentId) =>
      (await rescheduleAppointment(db, { appointmentId: id, interviewerId: "i1", startsAt: slot, actor: asStudent("s1"), now: NOW }));
    (await expectDomainError(async () => (await move(SLOT(48))), "SAME_SLOT"));
    (await expectDomainError(async () => (await move(SLOT(49))), "SLOT_TAKEN"));
    expect((await appt(mine.appointmentId)).status).toBe("scheduled"); // failed reschedule rolled back
    const second = (await move(SLOT(50)));
    const third = (await move(SLOT(51), second.appointmentId));
    (await expectDomainError(async () => (await move(SLOT(48), third.appointmentId)), "RESCHEDULE_LIMIT"));
  });
});

describe("outcomes", () => {
  let apptId: string;
  let attemptId: string;
  const afterStart = mins(95); // 10:35 IST
  beforeEach(async () => {
    (await makeEligible(db, "s1"));
    ({ appointmentId: apptId, attemptId } = (await book("s1", SLOT(0))));
  });
  const record = async (outcome: s.Outcome, actor = asInterviewer("i1"), now = afterStart) =>
    (await recordOutcome(db, { appointmentId: apptId, outcome, privateNotes: "note", actor, now }));

  it("cannot be recorded before the interview starts", async () => {
    (await expectDomainError(async () => (await record("pass", asInterviewer("i1"), mins(30))), "TOO_EARLY"));
  });

  it("cannot be recorded by a different interviewer or by a student", async () => {
    (await expectDomainError(async () => (await record("pass", asInterviewer("i2"))), "FORBIDDEN"));
    (await expectDomainError(async () => (await record("pass", asStudent("s1"))), "FORBIDDEN"));
  });

  it("cannot be recorded for a cancelled or no-show appointment", async () => {
    (await cancelAppointment(db, { appointmentId: apptId, actor: TEAM, now: NOW }));
    (await expectDomainError(async () => (await record("pass")), "INVALID_STATE"));
    const second = (await book("s1", SLOT(1)));
    (await markAbsence(db, { appointmentId: second.appointmentId, kind: "no_show", actor: asInterviewer("i1"), now: mins(120) }));
    (await expectDomainError(
      async () => (await recordOutcome(db, { appointmentId: second.appointmentId, outcome: "fail", actor: asInterviewer("i1"), now: mins(121) })),
      "INVALID_STATE",
    ));
  });

  it("pass: completes the appointment, finalises the attempt and awards the badge", async () => {
    const r = (await record("pass"));
    expect((await appt(apptId)).status).toBe("completed");
    expect((await attempt(attemptId))).toMatchObject({ status: "passed", closedAt: afterStart.toISOString() });
    const awards = (await db.select().from(s.badgeAwards).all());
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ id: r.awardId, status: "active", attemptId });
    expect((await journey("s1", afterStart))).toBe("passed");
    (await expectDomainError(async () => (await book("s1", SLOT(48), "i1", afterStart)), "BADGE_EARNED"));
    const types = (await listAudit(db)).map((e) => e.eventType);
    for (const t of ["appointment.completed", "attempt.awaiting_outcome", "outcome.recorded", "badge.awarded"])
      expect(types).toContain(t);
  });

  it("is idempotent for a duplicate submit and refuses a conflicting overwrite", async () => {
    (await record("pass"));
    expect((await record("pass", asInterviewer("i1"), mins(100))).replayed).toBe(true);
    (await expectDomainError(async () => (await record("fail")), "OUTCOME_FINAL"));
    (await expectDomainError(async () => (await record("retake_later", TEAM)), "OUTCOME_FINAL"));
    expect((await rows(s.attemptOutcomes))).toHaveLength(1);
    expect((await rows(s.badgeAwards))).toHaveLength(1);
  });

  it("supports the two-step path: mark conducted, then record", async () => {
    (await expectDomainError(async () => (await markConducted(db, { appointmentId: apptId, actor: asInterviewer("i1"), now: mins(10) })), "TOO_EARLY"));
    (await markConducted(db, { appointmentId: apptId, actor: asInterviewer("i1"), now: afterStart }));
    expect((await attempt(attemptId)).status).toBe("awaiting_outcome");
    expect((await journey("s1", afterStart))).toBe("awaiting_outcome");
    (await expectDomainError(async () => (await book("s1", SLOT(48), "i1", afterStart)), "AWAITING_OUTCOME"));
    (await record("fail", asInterviewer("i1"), mins(100)));
    expect((await attempt(attemptId)).status).toBe("failed");
  });

  it("fail: keeps the attempt in history and blocks self-booking until the team opens a new attempt", async () => {
    (await record("fail"));
    expect((await journey("s1", afterStart))).toBe("failed");
    expect((await rows(s.badgeAwards))).toHaveLength(0);
    (await expectDomainError(async () => (await book("s1", SLOT(48), "i1", afterStart)), "FAILED_NEEDS_GRANT"));
    (await grantReattempt(db, { studentId: "s1", badgeId: "badge", reason: "Revision completed", actor: TEAM, now: afterStart }));
    const second = (await book("s1", SLOT(48), "i1", afterStart));
    expect((await attempt(second.attemptId)).attemptNo).toBe(2);
    expect((await attempt(attemptId)).status).toBe("failed"); // history untouched
    expect((await journey("s1", afterStart))).toBe("booked");
    const view = (await getStudentBadgeView(db, "s1", "badge", afterStart))!;
    expect(view.attempts.map((a) => [a.attemptNo, a.status])).toEqual([
      [2, "awaiting_interview"],
      [1, "failed"],
    ]);
    // the grant is single-use
    expect((await db.select().from(s.attemptGrants).all())[0].consumedByAttemptId).toBe(second.attemptId);
  });

  it("retake later: distinct from fail - the student re-books themselves once the window opens", async () => {
    (await recordOutcome(db, { appointmentId: apptId, outcome: "retake_later", retakeWaitDays: 3, actor: asInterviewer("i1"), now: afterStart }));
    expect((await attempt(attemptId)).status).toBe("retake_later");
    expect((await journey("s1", afterStart))).toBe("retake_later");
    (await expectDomainError(async () => (await book("s1", SLOT(48), "i1", afterStart)), "RETAKE_NOT_YET"));
    const day4 = hours(24 * 4);
    (await createWindow(db, { interviewerId: "i1", day: "2026-11-07", startHm: "10:00", endHm: "11:00", actor: asInterviewer("i1"), now: day4 }));
    const again = (await bookAppointment(db, {
      studentId: "s1",
      badgeId: "badge",
      interviewerId: "i1",
      startsAt: "2026-11-07T04:30:00.000Z",
      actor: asStudent("s1"),
      now: day4,
    }));
    expect((await attempt(again.attemptId)).attemptNo).toBe(2);
  });

  it("grant is refused unless the latest attempt failed", async () => {
    (await expectDomainError(
      async () => (await grantReattempt(db, { studentId: "s1", badgeId: "badge", reason: "No reason at all", actor: TEAM, now: NOW })),
      "INVALID_STATE",
    ));
  });

  it("no-show leaves the attempt open with no outcome; the student can re-book", async () => {
    (await expectDomainError(
      async () => (await markAbsence(db, { appointmentId: apptId, kind: "no_show", actor: asInterviewer("i1"), now: mins(65) })),
      "TOO_EARLY",
    ));
    (await expectDomainError(
      async () => (await markAbsence(db, { appointmentId: apptId, kind: "interviewer_absent", actor: asInterviewer("i1"), now: mins(80) })),
      "FORBIDDEN",
    ));
    (await markAbsence(db, { appointmentId: apptId, kind: "no_show", actor: asInterviewer("i1"), now: mins(80) }));
    expect((await appt(apptId)).status).toBe("no_show");
    expect((await attempt(attemptId)).status).toBe("awaiting_interview");
    expect((await rows(s.attemptOutcomes))).toHaveLength(0);
    const again = (await book("s1", SLOT(48), "i1", mins(80)));
    expect(again.attemptId).toBe(attemptId);
  });

  it("corrections are team-only, need a reason, and append rather than overwrite", async () => {
    (await record("fail"));
    const fix = { attemptId, outcome: "retake_later" as const, reason: "Interviewer selected the wrong option", now: hours(3) };
    (await expectDomainError(async () => (await correctOutcome(db, { ...fix, actor: asInterviewer("i1") })), "FORBIDDEN"));
    (await expectDomainError(async () => (await correctOutcome(db, { ...fix, reason: "typo", actor: TEAM })), "REASON_REQUIRED"));
    (await correctOutcome(db, { ...fix, actor: TEAM }));
    const ledger = (await db.select().from(s.attemptOutcomes).where(eq(s.attemptOutcomes.attemptId, attemptId)).all());
    expect(ledger).toHaveLength(2);
    const [original] = ledger.filter((o) => !o.isCurrent);
    const [current] = ledger.filter((o) => o.isCurrent);
    expect(original).toMatchObject({ outcome: "fail", privateNotes: "note" });
    expect(current).toMatchObject({ outcome: "retake_later", supersedesId: original.id, recordedByRole: "team" });
    expect((await attempt(attemptId)).status).toBe("retake_later");
    expect((await listAudit(db)).some((e) => e.eventType === "outcome.corrected")).toBe(true);
  });

  it("a pass cannot be corrected away - nullification is the only route", async () => {
    (await record("pass"));
    (await expectDomainError(
      async () => (await correctOutcome(db, { attemptId, outcome: "fail", reason: "Changed our mind about it", actor: TEAM, now: hours(3) })),
      "INVALID_CORRECTION",
    ));
  });
});

describe("badge nullification", () => {
  let awardId: string;
  let attemptId: string;
  const later = hours(24 * 10);
  beforeEach(async () => {
    (await makeEligible(db, "s1"));
    const b = (await book("s1", SLOT(0)));
    attemptId = b.attemptId;
    awardId = (await recordOutcome(db, { appointmentId: b.appointmentId, outcome: "pass", actor: asInterviewer("i1"), now: mins(95) })).awardId!;
  });

  it("requires the interview team and a real reason", async () => {
    (await expectDomainError(
      async () => (await nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed", actor: asInterviewer("i1"), now: later })),
      "FORBIDDEN",
    ));
    (await expectDomainError(async () => (await nullifyBadge(db, { awardId, reason: "  bad ", actor: TEAM, now: later })), "REASON_REQUIRED"));
    expect((await db.select().from(s.badgeAwards).get())!.status).toBe("active");
  });

  it("flips the award to nullified but preserves the pass, the award row and the history", async () => {
    (await nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed on recording", actor: TEAM, now: later }));
    const award = (await db.select().from(s.badgeAwards).get())!;
    expect(award).toMatchObject({ id: awardId, status: "nullified", attemptId, awardedAt: mins(95).toISOString() });
    expect((await attempt(attemptId)).status).toBe("passed"); // not rewritten as a fail
    const outcome = (await db
      .select()
      .from(s.attemptOutcomes)
      .where(and(eq(s.attemptOutcomes.attemptId, attemptId), eq(s.attemptOutcomes.isCurrent, true)))
      .get())!;
    expect(outcome.outcome).toBe("pass");
    expect((await db.select().from(s.badgeNullifications).get())).toMatchObject({ awardId, confirmedById: "team_ops" });
    expect((await journey("s1", later))).toBe("nullified");
    (await expectDomainError(async () => (await book("s1", SLOT(48), "i1", NOW)), "BADGE_NULLIFIED"));
    const events = (await listAudit(db, { studentId: "s1" })).map((e) => e.eventType);
    expect(events).toContain("badge.awarded");
    expect(events).toContain("badge.nullified");
  });

  it("is idempotent when confirmed twice", async () => {
    const a = (await nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed on recording", actor: TEAM, now: later }));
    const b = (await nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed on recording", actor: TEAM, now: later }));
    expect(b).toEqual({ nullificationId: a.nullificationId, replayed: true });
    expect((await rows(s.badgeNullifications))).toHaveLength(1);
  });
});

describe("interviewer availability", () => {
  const me = asInterviewer("i1");
  const add = async (startHm: string, endHm: string, day = "2026-11-02", now = NOW) =>
    (await createWindow(db, { interviewerId: "i1", day, startHm, endHm, actor: me, now }));

  it("rejects overlapping, inverted, off-grid and past windows; allows adjacent ones", async () => {
    (await expectDomainError(async () => (await add("11:30", "12:30")), "OVERLAP")); // overlaps 10:00-12:00
    (await expectDomainError(async () => (await add("09:00", "10:30")), "OVERLAP"));
    (await expectDomainError(async () => (await add("15:00", "14:00")), "INVALID_RANGE"));
    (await expectDomainError(async () => (await add("15:10", "16:00")), "INVALID_RANGE"));
    (await expectDomainError(async () => (await add("06:00", "08:00")), "IN_PAST")); // now is 09:00 IST
    (await expectDomainError(async () => (await createWindow(db, { interviewerId: "i2", day: "2026-11-03", startHm: "10:00", endHm: "11:00", actor: me, now: NOW })), "FORBIDDEN"));
    (await add("12:00", "13:00")); // touches the existing window, no overlap
    expect((await rows(s.availabilityWindows))).toHaveLength(4);
  });

  it("refuses to silently invalidate a booking when a window is shrunk or removed", async () => {
    (await makeEligible(db, "s1"));
    const b = (await book("s1", SLOT(3))); // 11:30-12:00 IST
    const err = (await expectDomainError(
      async () => (await updateWindow(db, { windowId: "w1", day: "2026-11-02", startHm: "10:00", endHm: "11:00", actor: me, now: NOW })),
      "BOOKING_CONFLICT",
    ));
    expect((err.details as { conflicts: { appointmentId: string }[] }).conflicts.map((c) => c.appointmentId)).toEqual([
      b.appointmentId,
    ]);
    (await expectDomainError(async () => (await deleteWindow(db, { windowId: "w1", actor: me, now: NOW })), "BOOKING_CONFLICT"));
    expect((await appt(b.appointmentId)).status).toBe("scheduled");
    // A change that still covers the booking is fine.
    (await updateWindow(db, { windowId: "w1", day: "2026-11-02", startHm: "11:00", endHm: "12:00", actor: me, now: NOW }));
    expect((await appt(b.appointmentId)).status).toBe("scheduled");
  });

  it("with explicit resolution, releases the booking, records why and lets the student re-book", async () => {
    (await makeEligible(db, "s1"));
    const b = (await book("s1", SLOT(3)));
    const r = (await deleteWindow(db, { windowId: "w1", resolution: "release", actor: me, now: NOW }));
    expect(r.released).toBe(1);
    expect((await appt(b.appointmentId))).toMatchObject({ status: "cancelled", closedBy: "interviewer" });
    expect((await journey("s1"))).toBe("eligible_unbooked");
    expect((await book("s1", SLOT(48))).attemptId).toBe(b.attemptId);
  });
});

describe("seeded demo data", () => {
  it("produces exactly the numbers the team dashboard reports", async () => {
    const seeded = (await openDatabase(":memory:"));
    const now = new Date();
    (await seedDemoData(seeded, now));
    const o = (await getOverview(seeded, now));
    expect({
      eligible: o.eligible,
      unbooked: o.unbooked,
      booked: o.booked,
      outcomePending: o.outcomePending,
      completed: o.completed,
      outcomes: o.outcomes,
      badgesActive: o.badgesActive,
      badgesNullified: o.badgesNullified,
      noShows: o.noShows,
    }).toEqual(SEED_EXPECTATIONS);
    const roster = (await getRoster(seeded, now));
    const state = (id: string) => roster.find((r) => r.studentId === id)?.journey;
    expect(state("stu_mira")).toBeUndefined(); // not eligible -> not on the roster
    expect(state("stu_kabir")).toBe("eligible_unbooked");
    expect(state("stu_tara")).toBe("booked");
    expect(state("stu_dev")).toBe("awaiting_outcome");
    expect(state("stu_isha")).toBe("passed");
    expect(state("stu_rohan")).toBe("failed");
    expect(state("stu_neha")).toBe("retake_later");
    expect(state("stu_arjun")).toBe("nullified");
    expect(state("stu_zoya")).toBe("booked");
    // every journey state sums back to the eligible total
    expect(Object.values(o.byJourney).reduce((a, b) => a + b, 0)).toBe(o.eligible);
  });

  it("can be reset repeatedly without duplicating anything", async () => {
    const seeded = (await openDatabase(":memory:"));
    (await resetDemoData(seeded));
    const before = (await seeded.select().from(s.auditEvents).all()).length;
    (await resetDemoData(seeded));
    expect((await seeded.select().from(s.students).all())).toHaveLength(13);
    expect((await seeded.select().from(s.auditEvents).all())).toHaveLength(before);
  });

  it("rolls back the entire reset if fixture creation fails", async () => {
    const seeded = (await openDatabase(":memory:"));
    (await resetDemoData(seeded));
    const beforeStudents = (await seeded.select().from(s.students).all());
    const beforeEvents = (await seeded.select().from(s.auditEvents).all());
    (await seeded.run(sql.raw("CREATE TRIGGER fail_demo_seed BEFORE INSERT ON students BEGIN SELECT RAISE(ABORT, 'seed failure'); END")));

    await expect(resetDemoData(seeded)).rejects.toThrow();
    expect((await seeded.select().from(s.students).all())).toEqual(beforeStudents);
    expect((await seeded.select().from(s.auditEvents).all())).toEqual(beforeEvents);
  });
});
