import { and, eq } from "drizzle-orm";
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
beforeEach(() => {
  db = makeWorld();
});

const book = (studentId = "s1", slot = SLOT(0), interviewerId = "i1", now = NOW, key?: string) =>
  bookAppointment(db, {
    studentId,
    badgeId: "badge",
    interviewerId,
    startsAt: slot,
    idempotencyKey: key,
    actor: asStudent(studentId),
    now,
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (table: any): unknown[] => db.select().from(table).all();
const appt = (id: string) => db.select().from(s.appointments).where(eq(s.appointments.id, id)).get()!;
const attempt = (id: string) => db.select().from(s.interviewAttempts).where(eq(s.interviewAttempts.id, id)).get()!;
const journey = (studentId: string, now = NOW) => loadBadgeContext(db, studentId, "badge", now).journey;

describe("eligibility", () => {
  it("unlocks the interview only when the final required skill is cleared", () => {
    clearSkill(db, { studentId: "s1", skillId: "A", now: NOW });
    expect(journey("s1")).toBe("locked");
    expectDomainError(() => book(), "NOT_ELIGIBLE");
    const r = clearSkill(db, { studentId: "s1", skillId: "B", now: mins(5) });
    expect(r.newlyEligibleBadgeIds).toEqual(["badge"]);
    expect(journey("s1")).toBe("eligible_unbooked");
    const e = db.select().from(s.badgeEligibilities).all();
    expect(e).toHaveLength(1);
    expect(e[0].eligibleAt).toBe(mins(5).toISOString());
  });

  it("is idempotent when a skill completion is delivered twice", () => {
    makeEligible(db, "s1");
    const again = clearSkill(db, { studentId: "s1", skillId: "B", now: hours(1) });
    expect(again).toEqual({ alreadyCleared: true, newlyEligibleBadgeIds: [] });
    expect(rows(s.badgeEligibilities)).toHaveLength(1);
    expect(rows(s.studentSkillCompletions)).toHaveLength(2);
    expect(listAudit(db).filter((e) => e.eventType === "eligibility.granted")).toHaveLength(1);
  });
});

describe("slots and booking", () => {
  beforeEach(() => {
    makeEligible(db, "s1");
    makeEligible(db, "s2");
  });

  it("derives real slots from availability and hides past / too-soon ones", () => {
    const all = listOpenSlots(db, { from: NOW, to: hours(48), now: NOW });
    expect(all.filter((x) => x.interviewerId === "i1")).toHaveLength(8);
    expect(all.filter((x) => x.interviewerId === "i2")).toHaveLength(2);
    // 09:45 IST: the 10:00 slot is inside the 30-minute lead time.
    const later = listOpenSlots(db, { from: NOW, to: hours(48), now: mins(45) });
    expect(later.some((x) => x.startsAt === SLOT(0))).toBe(false);
    expect(later.some((x) => x.startsAt === SLOT(1))).toBe(true);
  });

  it("books a slot, opens attempt 1 and removes the slot from availability", () => {
    const r = book();
    expect(appt(r.appointmentId)).toMatchObject({ status: "scheduled", startsAt: SLOT(0), endsAt: SLOT(1) });
    expect(attempt(r.attemptId)).toMatchObject({ attemptNo: 1, status: "awaiting_interview" });
    expect(journey("s1")).toBe("booked");
    const open = listOpenSlots(db, { from: NOW, to: hours(48), now: NOW });
    expect(open.some((x) => x.interviewerId === "i1" && x.startsAt === SLOT(0))).toBe(false);
    expect(open.some((x) => x.interviewerId === "i2" && x.startsAt === SLOT(0))).toBe(true);
  });

  it("never lets two students hold the same slot", () => {
    book("s1");
    expectDomainError(() => book("s2"), "SLOT_TAKEN");
    expect(rows(s.appointments)).toHaveLength(1);
    // The failed booking must not leave an orphan attempt behind.
    expect(rows(s.interviewAttempts)).toHaveLength(1);
  });

  it("enforces the slot rule in the database even if the service check is bypassed", () => {
    const r = book("s1");
    const a = appt(r.appointmentId);
    expect(() =>
      db
        .insert(s.appointments)
        .values({ ...a, id: "dup", attemptId: a.attemptId, studentId: "s2", idempotencyKey: null })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("stops one student holding two active appointments for a badge", () => {
    book("s1", SLOT(0));
    expectDomainError(() => book("s1", SLOT(2)), "ALREADY_BOOKED");
  });

  it("stops a student double-booking themselves across badges at the same time", () => {
    makeEligible(db, "s1", NOW, "badge2");
    book("s1", SLOT(0), "i1");
    expectDomainError(
      () =>
        bookAppointment(db, {
          studentId: "s1",
          badgeId: "badge2",
          interviewerId: "i2",
          startsAt: SLOT(0),
          actor: asStudent("s1"),
          now: NOW,
        }),
      "STUDENT_CONFLICT",
    );
  });

  it("returns the original booking when the same submit is replayed", () => {
    const first = book("s1", SLOT(0), "i1", NOW, "key-1");
    const second = book("s1", SLOT(0), "i1", mins(1), "key-1");
    expect(second).toEqual({ ...first, replayed: true });
    expect(rows(s.appointments)).toHaveLength(1);
    expect(listAudit(db).filter((e) => e.eventType === "appointment.booked")).toHaveLength(1);
  });

  it("rejects past, off-grid, too-soon and unoffered times", () => {
    expectDomainError(() => book("s1", SLOT(0), "i1", hours(3)), "SLOT_IN_PAST");
    expectDomainError(() => book("s1", SLOT(0), "i1", mins(45)), "SLOT_TOO_SOON");
    expectDomainError(() => book("s1", "2026-11-02T04:40:00.000Z"), "SLOT_UNAVAILABLE");
    expectDomainError(() => book("s1", SLOT(10)), "SLOT_UNAVAILABLE");
    expectDomainError(() => book("s1", "tomorrow at ten"), "INVALID_SLOT");
    expectDomainError(() => book("s1", SLOT(3), "i2"), "SLOT_UNAVAILABLE");
  });

  it("rejects a slot whose availability was removed while the student was choosing", () => {
    deleteWindow(db, { windowId: "w1", actor: asInterviewer("i1"), now: NOW });
    expectDomainError(() => book("s1", SLOT(0)), "SLOT_UNAVAILABLE");
  });
});

describe("cancel and reschedule", () => {
  beforeEach(() => makeEligible(db, "s1"));

  it("cancelling keeps the row, frees the slot and lets the student re-book on the same attempt", () => {
    const first = book("s1", SLOT(48));
    cancelAppointment(db, { appointmentId: first.appointmentId, reason: "exam", actor: asStudent("s1"), now: hours(1) });
    expect(appt(first.appointmentId)).toMatchObject({ status: "cancelled", closedBy: "student", closeReason: "exam" });
    expect(journey("s1")).toBe("eligible_unbooked");
    expect(listOpenSlots(db, { from: NOW, to: hours(48), now: NOW }).some((x) => x.startsAt === SLOT(48))).toBe(true);
    const again = book("s1", SLOT(49), "i1", hours(2));
    expect(again.attemptId).toBe(first.attemptId);
    expect(attempt(again.attemptId).attemptNo).toBe(1);
    expect(rows(s.appointments)).toHaveLength(2);
  });

  it("treats a repeated cancel as a no-op", () => {
    const r = book("s1", SLOT(48));
    cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s1"), now: NOW });
    expect(cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s1"), now: NOW })).toEqual({
      replayed: true,
    });
    expect(listAudit(db).filter((e) => e.eventType === "appointment.cancelled")).toHaveLength(1);
  });

  it("closes the student change window 2 hours before the start, but not for the team", () => {
    const r = book("s1", SLOT(4 - 1)); // 11:30 IST today
    const late = mins(60); // 10:00 IST -> 90 minutes before
    expectDomainError(
      () => cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s1"), now: late }),
      "CHANGE_WINDOW_CLOSED",
    );
    expectDomainError(
      () =>
        rescheduleAppointment(db, {
          appointmentId: r.appointmentId,
          interviewerId: "i1",
          startsAt: SLOT(48),
          actor: asStudent("s1"),
          now: late,
        }),
      "CHANGE_WINDOW_CLOSED",
    );
    cancelAppointment(db, { appointmentId: r.appointmentId, actor: TEAM, now: late });
    expect(appt(r.appointmentId).status).toBe("cancelled");
  });

  it("does not let a student cancel someone else's interview", () => {
    const r = book("s1", SLOT(48));
    expectDomainError(
      () => cancelAppointment(db, { appointmentId: r.appointmentId, actor: asStudent("s2"), now: NOW }),
      "FORBIDDEN",
    );
  });

  it("rescheduling keeps the original row and links the replacement to it", () => {
    const first = book("s1", SLOT(48));
    const moved = rescheduleAppointment(db, {
      appointmentId: first.appointmentId,
      interviewerId: "i1",
      startsAt: SLOT(50),
      actor: asStudent("s1"),
      now: hours(1),
    });
    expect(appt(first.appointmentId).status).toBe("rescheduled");
    expect(appt(moved.appointmentId)).toMatchObject({
      status: "scheduled",
      startsAt: SLOT(50),
      rescheduledFromId: first.appointmentId,
      attemptId: first.attemptId,
    });
    const open = listOpenSlots(db, { from: NOW, to: hours(48), now: NOW });
    expect(open.some((x) => x.startsAt === SLOT(48))).toBe(true);
    expect(open.some((x) => x.startsAt === SLOT(50))).toBe(false);
  });

  it("rejects rescheduling to the same slot, a taken slot, and beyond the limit", () => {
    makeEligible(db, "s2");
    const mine = book("s1", SLOT(48));
    book("s2", SLOT(49));
    const move = (slot: string, id = mine.appointmentId) =>
      rescheduleAppointment(db, { appointmentId: id, interviewerId: "i1", startsAt: slot, actor: asStudent("s1"), now: NOW });
    expectDomainError(() => move(SLOT(48)), "SAME_SLOT");
    expectDomainError(() => move(SLOT(49)), "SLOT_TAKEN");
    expect(appt(mine.appointmentId).status).toBe("scheduled"); // failed reschedule rolled back
    const second = move(SLOT(50));
    const third = move(SLOT(51), second.appointmentId);
    expectDomainError(() => move(SLOT(48), third.appointmentId), "RESCHEDULE_LIMIT");
  });
});

describe("outcomes", () => {
  let apptId: string;
  let attemptId: string;
  const afterStart = mins(95); // 10:35 IST
  beforeEach(() => {
    makeEligible(db, "s1");
    ({ appointmentId: apptId, attemptId } = book("s1", SLOT(0)));
  });
  const record = (outcome: s.Outcome, actor = asInterviewer("i1"), now = afterStart) =>
    recordOutcome(db, { appointmentId: apptId, outcome, privateNotes: "note", actor, now });

  it("cannot be recorded before the interview starts", () => {
    expectDomainError(() => record("pass", asInterviewer("i1"), mins(30)), "TOO_EARLY");
  });

  it("cannot be recorded by a different interviewer or by a student", () => {
    expectDomainError(() => record("pass", asInterviewer("i2")), "FORBIDDEN");
    expectDomainError(() => record("pass", asStudent("s1")), "FORBIDDEN");
  });

  it("cannot be recorded for a cancelled or no-show appointment", () => {
    cancelAppointment(db, { appointmentId: apptId, actor: TEAM, now: NOW });
    expectDomainError(() => record("pass"), "INVALID_STATE");
    const second = book("s1", SLOT(1));
    markAbsence(db, { appointmentId: second.appointmentId, kind: "no_show", actor: asInterviewer("i1"), now: mins(120) });
    expectDomainError(
      () => recordOutcome(db, { appointmentId: second.appointmentId, outcome: "fail", actor: asInterviewer("i1"), now: mins(121) }),
      "INVALID_STATE",
    );
  });

  it("pass: completes the appointment, finalises the attempt and awards the badge", () => {
    const r = record("pass");
    expect(appt(apptId).status).toBe("completed");
    expect(attempt(attemptId)).toMatchObject({ status: "passed", closedAt: afterStart.toISOString() });
    const awards = db.select().from(s.badgeAwards).all();
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ id: r.awardId, status: "active", attemptId });
    expect(journey("s1", afterStart)).toBe("passed");
    expectDomainError(() => book("s1", SLOT(48), "i1", afterStart), "BADGE_EARNED");
    const types = listAudit(db).map((e) => e.eventType);
    for (const t of ["appointment.completed", "attempt.awaiting_outcome", "outcome.recorded", "badge.awarded"])
      expect(types).toContain(t);
  });

  it("is idempotent for a duplicate submit and refuses a conflicting overwrite", () => {
    record("pass");
    expect(record("pass", asInterviewer("i1"), mins(100)).replayed).toBe(true);
    expectDomainError(() => record("fail"), "OUTCOME_FINAL");
    expectDomainError(() => record("retake_later", TEAM), "OUTCOME_FINAL");
    expect(rows(s.attemptOutcomes)).toHaveLength(1);
    expect(rows(s.badgeAwards)).toHaveLength(1);
  });

  it("supports the two-step path: mark conducted, then record", () => {
    expectDomainError(() => markConducted(db, { appointmentId: apptId, actor: asInterviewer("i1"), now: mins(10) }), "TOO_EARLY");
    markConducted(db, { appointmentId: apptId, actor: asInterviewer("i1"), now: afterStart });
    expect(attempt(attemptId).status).toBe("awaiting_outcome");
    expect(journey("s1", afterStart)).toBe("awaiting_outcome");
    expectDomainError(() => book("s1", SLOT(48), "i1", afterStart), "AWAITING_OUTCOME");
    record("fail", asInterviewer("i1"), mins(100));
    expect(attempt(attemptId).status).toBe("failed");
  });

  it("fail: keeps the attempt in history and blocks self-booking until the team opens a new attempt", () => {
    record("fail");
    expect(journey("s1", afterStart)).toBe("failed");
    expect(rows(s.badgeAwards)).toHaveLength(0);
    expectDomainError(() => book("s1", SLOT(48), "i1", afterStart), "FAILED_NEEDS_GRANT");
    grantReattempt(db, { studentId: "s1", badgeId: "badge", reason: "Revision completed", actor: TEAM, now: afterStart });
    const second = book("s1", SLOT(48), "i1", afterStart);
    expect(attempt(second.attemptId).attemptNo).toBe(2);
    expect(attempt(attemptId).status).toBe("failed"); // history untouched
    expect(journey("s1", afterStart)).toBe("booked");
    const view = getStudentBadgeView(db, "s1", "badge", afterStart)!;
    expect(view.attempts.map((a) => [a.attemptNo, a.status])).toEqual([
      [2, "awaiting_interview"],
      [1, "failed"],
    ]);
    // the grant is single-use
    expect(db.select().from(s.attemptGrants).all()[0].consumedByAttemptId).toBe(second.attemptId);
  });

  it("retake later: distinct from fail - the student re-books themselves once the window opens", () => {
    recordOutcome(db, { appointmentId: apptId, outcome: "retake_later", retakeWaitDays: 3, actor: asInterviewer("i1"), now: afterStart });
    expect(attempt(attemptId).status).toBe("retake_later");
    expect(journey("s1", afterStart)).toBe("retake_later");
    expectDomainError(() => book("s1", SLOT(48), "i1", afterStart), "RETAKE_NOT_YET");
    const day4 = hours(24 * 4);
    createWindow(db, { interviewerId: "i1", day: "2026-11-07", startHm: "10:00", endHm: "11:00", actor: asInterviewer("i1"), now: day4 });
    const again = bookAppointment(db, {
      studentId: "s1",
      badgeId: "badge",
      interviewerId: "i1",
      startsAt: "2026-11-07T04:30:00.000Z",
      actor: asStudent("s1"),
      now: day4,
    });
    expect(attempt(again.attemptId).attemptNo).toBe(2);
  });

  it("grant is refused unless the latest attempt failed", () => {
    expectDomainError(
      () => grantReattempt(db, { studentId: "s1", badgeId: "badge", reason: "No reason at all", actor: TEAM, now: NOW }),
      "INVALID_STATE",
    );
  });

  it("no-show leaves the attempt open with no outcome; the student can re-book", () => {
    expectDomainError(
      () => markAbsence(db, { appointmentId: apptId, kind: "no_show", actor: asInterviewer("i1"), now: mins(65) }),
      "TOO_EARLY",
    );
    expectDomainError(
      () => markAbsence(db, { appointmentId: apptId, kind: "interviewer_absent", actor: asInterviewer("i1"), now: mins(80) }),
      "FORBIDDEN",
    );
    markAbsence(db, { appointmentId: apptId, kind: "no_show", actor: asInterviewer("i1"), now: mins(80) });
    expect(appt(apptId).status).toBe("no_show");
    expect(attempt(attemptId).status).toBe("awaiting_interview");
    expect(rows(s.attemptOutcomes)).toHaveLength(0);
    const again = book("s1", SLOT(48), "i1", mins(80));
    expect(again.attemptId).toBe(attemptId);
  });

  it("corrections are team-only, need a reason, and append rather than overwrite", () => {
    record("fail");
    const fix = { attemptId, outcome: "retake_later" as const, reason: "Interviewer selected the wrong option", now: hours(3) };
    expectDomainError(() => correctOutcome(db, { ...fix, actor: asInterviewer("i1") }), "FORBIDDEN");
    expectDomainError(() => correctOutcome(db, { ...fix, reason: "typo", actor: TEAM }), "REASON_REQUIRED");
    correctOutcome(db, { ...fix, actor: TEAM });
    const ledger = db.select().from(s.attemptOutcomes).where(eq(s.attemptOutcomes.attemptId, attemptId)).all();
    expect(ledger).toHaveLength(2);
    const [original] = ledger.filter((o) => !o.isCurrent);
    const [current] = ledger.filter((o) => o.isCurrent);
    expect(original).toMatchObject({ outcome: "fail", privateNotes: "note" });
    expect(current).toMatchObject({ outcome: "retake_later", supersedesId: original.id, recordedByRole: "team" });
    expect(attempt(attemptId).status).toBe("retake_later");
    expect(listAudit(db).some((e) => e.eventType === "outcome.corrected")).toBe(true);
  });

  it("a pass cannot be corrected away - nullification is the only route", () => {
    record("pass");
    expectDomainError(
      () => correctOutcome(db, { attemptId, outcome: "fail", reason: "Changed our mind about it", actor: TEAM, now: hours(3) }),
      "INVALID_CORRECTION",
    );
  });
});

describe("badge nullification", () => {
  let awardId: string;
  let attemptId: string;
  const later = hours(24 * 10);
  beforeEach(() => {
    makeEligible(db, "s1");
    const b = book("s1", SLOT(0));
    attemptId = b.attemptId;
    awardId = recordOutcome(db, { appointmentId: b.appointmentId, outcome: "pass", actor: asInterviewer("i1"), now: mins(95) }).awardId!;
  });

  it("requires the interview team and a real reason", () => {
    expectDomainError(
      () => nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed", actor: asInterviewer("i1"), now: later }),
      "FORBIDDEN",
    );
    expectDomainError(() => nullifyBadge(db, { awardId, reason: "  bad ", actor: TEAM, now: later }), "REASON_REQUIRED");
    expect(db.select().from(s.badgeAwards).get()!.status).toBe("active");
  });

  it("flips the award to nullified but preserves the pass, the award row and the history", () => {
    nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed on recording", actor: TEAM, now: later });
    const award = db.select().from(s.badgeAwards).get()!;
    expect(award).toMatchObject({ id: awardId, status: "nullified", attemptId, awardedAt: mins(95).toISOString() });
    expect(attempt(attemptId).status).toBe("passed"); // not rewritten as a fail
    const outcome = db
      .select()
      .from(s.attemptOutcomes)
      .where(and(eq(s.attemptOutcomes.attemptId, attemptId), eq(s.attemptOutcomes.isCurrent, true)))
      .get()!;
    expect(outcome.outcome).toBe("pass");
    expect(db.select().from(s.badgeNullifications).get()).toMatchObject({ awardId, confirmedById: "team_ops" });
    expect(journey("s1", later)).toBe("nullified");
    expectDomainError(() => book("s1", SLOT(48), "i1", NOW), "BADGE_NULLIFIED");
    const events = listAudit(db, { studentId: "s1" }).map((e) => e.eventType);
    expect(events).toContain("badge.awarded");
    expect(events).toContain("badge.nullified");
  });

  it("is idempotent when confirmed twice", () => {
    const a = nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed on recording", actor: TEAM, now: later });
    const b = nullifyBadge(db, { awardId, reason: "Proxy candidate confirmed on recording", actor: TEAM, now: later });
    expect(b).toEqual({ nullificationId: a.nullificationId, replayed: true });
    expect(rows(s.badgeNullifications)).toHaveLength(1);
  });
});

describe("interviewer availability", () => {
  const me = asInterviewer("i1");
  const add = (startHm: string, endHm: string, day = "2026-11-02", now = NOW) =>
    createWindow(db, { interviewerId: "i1", day, startHm, endHm, actor: me, now });

  it("rejects overlapping, inverted, off-grid and past windows; allows adjacent ones", () => {
    expectDomainError(() => add("11:30", "12:30"), "OVERLAP"); // overlaps 10:00-12:00
    expectDomainError(() => add("09:00", "10:30"), "OVERLAP");
    expectDomainError(() => add("15:00", "14:00"), "INVALID_RANGE");
    expectDomainError(() => add("15:10", "16:00"), "INVALID_RANGE");
    expectDomainError(() => add("06:00", "08:00"), "IN_PAST"); // now is 09:00 IST
    expectDomainError(() => createWindow(db, { interviewerId: "i2", day: "2026-11-03", startHm: "10:00", endHm: "11:00", actor: me, now: NOW }), "FORBIDDEN");
    add("12:00", "13:00"); // touches the existing window, no overlap
    expect(rows(s.availabilityWindows)).toHaveLength(4);
  });

  it("refuses to silently invalidate a booking when a window is shrunk or removed", () => {
    makeEligible(db, "s1");
    const b = book("s1", SLOT(3)); // 11:30-12:00 IST
    const err = expectDomainError(
      () => updateWindow(db, { windowId: "w1", day: "2026-11-02", startHm: "10:00", endHm: "11:00", actor: me, now: NOW }),
      "BOOKING_CONFLICT",
    );
    expect((err.details as { conflicts: { appointmentId: string }[] }).conflicts.map((c) => c.appointmentId)).toEqual([
      b.appointmentId,
    ]);
    expectDomainError(() => deleteWindow(db, { windowId: "w1", actor: me, now: NOW }), "BOOKING_CONFLICT");
    expect(appt(b.appointmentId).status).toBe("scheduled");
    // A change that still covers the booking is fine.
    updateWindow(db, { windowId: "w1", day: "2026-11-02", startHm: "11:00", endHm: "12:00", actor: me, now: NOW });
    expect(appt(b.appointmentId).status).toBe("scheduled");
  });

  it("with explicit resolution, releases the booking, records why and lets the student re-book", () => {
    makeEligible(db, "s1");
    const b = book("s1", SLOT(3));
    const r = deleteWindow(db, { windowId: "w1", resolution: "release", actor: me, now: NOW });
    expect(r.released).toBe(1);
    expect(appt(b.appointmentId)).toMatchObject({ status: "cancelled", closedBy: "interviewer" });
    expect(journey("s1")).toBe("eligible_unbooked");
    expect(book("s1", SLOT(48)).attemptId).toBe(b.attemptId);
  });
});

describe("seeded demo data", () => {
  it("produces exactly the numbers the team dashboard reports", () => {
    const seeded = openDatabase(":memory:");
    const now = new Date();
    seedDemoData(seeded, now);
    const o = getOverview(seeded, now);
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
    const roster = getRoster(seeded, now);
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

  it("can be reset repeatedly without duplicating anything", () => {
    const seeded = openDatabase(":memory:");
    resetDemoData(seeded);
    const before = seeded.select().from(s.auditEvents).all().length;
    resetDemoData(seeded);
    expect(seeded.select().from(s.students).all()).toHaveLength(13);
    expect(seeded.select().from(s.auditEvents).all()).toHaveLength(before);
  });
});
