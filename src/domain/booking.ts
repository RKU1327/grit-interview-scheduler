import { and, asc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db";
import {
  appointments,
  attemptGrants,
  availabilityWindows,
  interviewAttempts,
  interviewers,
  students,
  trackBadges,
} from "@/db/schema";
import { fmtDateTime } from "@/lib/time";
import { audit, inTx, isUniqueViolation, loadBadgeContext, newId, type Actor } from "./core";
import { assertAppointmentTransition, assertAttemptTransition, canStudentChange, DomainError, POLICY } from "./policy";

const SLOT_MS = POLICY.slotMinutes * 60_000;
const LIVE = ["scheduled", "completed"] as const;

export type Slot = { interviewerId: string; interviewerName: string; startsAt: string; endsAt: string };

/**
 * Bookable slots in [from, to): every availability window is cut into
 * fixed-length slots aligned to the window start, minus slots that are in the
 * past / inside the lead time, or already held by a live appointment.
 */
export async function listOpenSlots(db: DbOrTx, input: { from: Date; to: Date; now: Date }): Promise<Slot[]> {
  const fromIso = input.from.toISOString();
  const toIso = input.to.toISOString();
  const windows = (await db
    .select({
      interviewerId: availabilityWindows.interviewerId,
      interviewerName: interviewers.name,
      startsAt: availabilityWindows.startsAt,
      endsAt: availabilityWindows.endsAt,
    })
    .from(availabilityWindows)
    .innerJoin(interviewers, eq(interviewers.id, availabilityWindows.interviewerId))
    .where(
      and(
        eq(interviewers.isActive, true),
        lt(availabilityWindows.startsAt, toIso),
        gt(availabilityWindows.endsAt, fromIso),
      ),
    )
    .all());
  const busy = (await db
    .select({ interviewerId: appointments.interviewerId, startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(and(inArray(appointments.status, [...LIVE]), lt(appointments.startsAt, toIso), gt(appointments.endsAt, fromIso)))
    .all());
  const earliest = input.now.getTime() + POLICY.bookingLeadMinutes * 60_000;

  const slots: Slot[] = [];
  for (const w of windows) {
    const wEnd = Date.parse(w.endsAt);
    for (let s = Date.parse(w.startsAt); s + SLOT_MS <= wEnd; s += SLOT_MS) {
      const e = s + SLOT_MS;
      if (s < earliest || s < input.from.getTime() || s >= input.to.getTime()) continue;
      const taken = busy.some(
        (b) => b.interviewerId === w.interviewerId && Date.parse(b.startsAt) < e && Date.parse(b.endsAt) > s,
      );
      if (taken) continue;
      slots.push({
        interviewerId: w.interviewerId,
        interviewerName: w.interviewerName,
        startsAt: new Date(s).toISOString(),
        endsAt: new Date(e).toISOString(),
      });
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.interviewerName.localeCompare(b.interviewerName));
}

/** Validate that a requested slot is real, future and free. Runs inside the write transaction. */
async function assertSlotBookable(
  tx: Tx,
  input: { interviewerId: string; startsAt: string; studentId: string; now: Date; ignoreAppointmentId?: string },
) {
  const start = Date.parse(input.startsAt);
  if (Number.isNaN(start) || new Date(start).toISOString() !== input.startsAt)
    throw new DomainError("INVALID_SLOT", "That time is not a valid interview slot.");
  const end = start + SLOT_MS;
  const endIso = new Date(end).toISOString();
  if (start < input.now.getTime())
    throw new DomainError("SLOT_IN_PAST", "That slot is in the past. Please choose an upcoming time.");
  if (start < input.now.getTime() + POLICY.bookingLeadMinutes * 60_000)
    throw new DomainError(
      "SLOT_TOO_SOON",
      `Slots must be booked at least ${POLICY.bookingLeadMinutes} minutes before they start.`,
    );
  const interviewer = (await tx.select().from(interviewers).where(eq(interviewers.id, input.interviewerId)).get());
  if (!interviewer || !interviewer.isActive) throw new DomainError("INVALID_SLOT", "That interviewer is not available.");

  const window = (await tx
    .select()
    .from(availabilityWindows)
    .where(
      and(
        eq(availabilityWindows.interviewerId, input.interviewerId),
        sql`${availabilityWindows.startsAt} <= ${input.startsAt}`,
        sql`${availabilityWindows.endsAt} >= ${endIso}`,
      ),
    )
    .get());
  if (!window || (start - Date.parse(window.startsAt)) % SLOT_MS !== 0)
    throw new DomainError(
      "SLOT_UNAVAILABLE",
      "That slot is no longer offered - the interviewer's availability changed. Please pick another time.",
    );

  const ignore = input.ignoreAppointmentId ?? "";
  const interviewerClash = (await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.interviewerId, input.interviewerId),
        inArray(appointments.status, [...LIVE]),
        lt(appointments.startsAt, endIso),
        gt(appointments.endsAt, input.startsAt),
        ne(appointments.id, ignore),
      ),
    )
    .get());
  if (interviewerClash)
    throw new DomainError("SLOT_TAKEN", "Someone just booked that slot. Please pick another time.");

  const studentClash = (await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.studentId, input.studentId),
        eq(appointments.status, "scheduled"),
        lt(appointments.startsAt, endIso),
        gt(appointments.endsAt, input.startsAt),
        ne(appointments.id, ignore),
      ),
    )
    .get());
  if (studentClash)
    throw new DomainError("STUDENT_CONFLICT", "You already have another interview at that time.");
  return { interviewer, endIso };
}

export type BookResult = { appointmentId: string; attemptId: string; replayed: boolean };

/**
 * Book an interview slot. One IMMEDIATE transaction re-checks eligibility and
 * the slot, then inserts. Partial unique indexes are the final guard against a
 * racing writer; a violation is reported as SLOT_TAKEN / ALREADY_BOOKED.
 */
export async function bookAppointment(
  db: DbOrTx,
  input: {
    studentId: string;
    badgeId: string;
    interviewerId: string;
    startsAt: string;
    idempotencyKey?: string;
    actor: Actor;
    now: Date;
  },
): Promise<BookResult> {
  try {
    return (await inTx(db, async (tx) => {
        if (input.idempotencyKey) {
          const prior = (await tx
            .select()
            .from(appointments)
            .where(eq(appointments.idempotencyKey, input.idempotencyKey))
            .get());
          if (prior) return { appointmentId: prior.id, attemptId: prior.attemptId, replayed: true };
        }
        const student = (await tx.select().from(students).where(eq(students.id, input.studentId)).get());
        const badge = (await tx.select().from(trackBadges).where(eq(trackBadges.id, input.badgeId)).get());
        if (!student || !badge) throw new DomainError("NOT_FOUND", "Unknown student or badge.");

        const ctx = (await loadBadgeContext(tx, student.id, badge.id, input.now));
        if (!ctx.gate.allowed) throw new DomainError(ctx.gate.code, ctx.gate.reason);
        const { interviewer, endIso } = (await assertSlotBookable(tx, { ...input, studentId: student.id }));

        const nowIso = input.now.toISOString();
        let attemptId = ctx.openAttempt?.id;
        if (!attemptId) {
          attemptId = newId("att");
          const attemptNo = (ctx.attempts.at(-1)?.attemptNo ?? 0) + 1;
          (await tx.insert(interviewAttempts)
            .values({
              id: attemptId,
              studentId: student.id,
              badgeId: badge.id,
              attemptNo,
              status: "awaiting_interview",
              openedAt: nowIso,
            })
            .run());
          if (ctx.unusedGrant) {
            (await tx.update(attemptGrants)
              .set({ consumedByAttemptId: attemptId })
              .where(eq(attemptGrants.id, ctx.unusedGrant.id))
              .run());
          }
          (await audit(tx, {
            entityType: "attempt",
            entityId: attemptId,
            studentId: student.id,
            badgeId: badge.id,
            eventType: "attempt.opened",
            toState: "awaiting_interview",
            actor: input.actor,
            summary: `Attempt ${attemptNo} opened for ${badge.name}`,
            detail: { attemptNo, usedGrantId: ctx.unusedGrant?.id ?? null },
            at: input.now,
          }));
        }

        const appointmentId = newId("apt");
        (await tx.insert(appointments)
          .values({
            id: appointmentId,
            attemptId,
            studentId: student.id,
            badgeId: badge.id,
            interviewerId: interviewer.id,
            startsAt: input.startsAt,
            endsAt: endIso,
            status: "scheduled",
            bookedAt: nowIso,
            updatedAt: nowIso,
            idempotencyKey: input.idempotencyKey ?? null,
          })
          .run());
        (await audit(tx, {
          entityType: "appointment",
          entityId: appointmentId,
          studentId: student.id,
          badgeId: badge.id,
          eventType: "appointment.booked",
          fromState: "unbooked",
          toState: "scheduled",
          actor: input.actor,
          summary: `Interview booked with ${interviewer.name} for ${fmtDateTime(input.startsAt)}`,
          detail: { interviewerId: interviewer.id, startsAt: input.startsAt, endsAt: endIso },
          at: input.now,
        }));
        return { appointmentId, attemptId, replayed: false };
      }));
  } catch (e) {
    if (isUniqueViolation(e)) {
      const msg = String((e as Error).message);
      if (msg.includes("appointments.attempt_id") || msg.includes("interview_attempts"))
        throw new DomainError("ALREADY_BOOKED", "You already have an interview booked for this badge.");
      if (msg.includes("appointments.student_id"))
        throw new DomainError("STUDENT_CONFLICT", "You already have another interview at that time.");
      throw new DomainError("SLOT_TAKEN", "Someone just booked that slot. Please pick another time.");
    }
    throw e;
  }
}

async function loadScheduled(tx: Tx, appointmentId: string) {
  const appt = (await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).get());
  if (!appt) throw new DomainError("NOT_FOUND", "That appointment does not exist.");
  return appt;
}

function assertActorMayTouch(appt: { studentId: string; interviewerId: string }, actor: Actor) {
  if (actor.role === "student" && actor.id !== appt.studentId)
    throw new DomainError("FORBIDDEN", "You can only manage your own interviews.");
  if (actor.role === "interviewer" && actor.id !== appt.interviewerId)
    throw new DomainError("FORBIDDEN", "This interview is assigned to a different interviewer.");
}

/**
 * Cancel a scheduled appointment. The attempt stays open (no outcome was
 * recorded), so the student can book again. Replaying a cancel is a no-op.
 */
export async function cancelAppointment(
  db: DbOrTx,
  input: { appointmentId: string; reason?: string; actor: Actor; now: Date },
): Promise<{ replayed: boolean }> {
  return (await inTx(db, async (tx) => {
      const appt = (await loadScheduled(tx, input.appointmentId));
      assertActorMayTouch(appt, input.actor);
      if (appt.status === "cancelled") return { replayed: true };
      assertAppointmentTransition(appt.status, "cancelled");
      if (input.actor.role === "student" && !canStudentChange(appt.startsAt, input.now))
        throw new DomainError(
          "CHANGE_WINDOW_CLOSED",
          `Interviews can be cancelled up to ${POLICY.changeCutoffMinutes / 60} hours before they start. Please contact the GRIT interview team.`,
        );
      const reason = input.reason?.trim() || null;
      (await tx.update(appointments)
        .set({ status: "cancelled", closedBy: input.actor.role, closeReason: reason, updatedAt: input.now.toISOString() })
        .where(and(eq(appointments.id, appt.id), eq(appointments.status, "scheduled")))
        .run());
      (await audit(tx, {
        entityType: "appointment",
        entityId: appt.id,
        studentId: appt.studentId,
        badgeId: appt.badgeId,
        eventType: "appointment.cancelled",
        fromState: "scheduled",
        toState: "cancelled",
        actor: input.actor,
        summary: `Interview on ${fmtDateTime(appt.startsAt)} cancelled by ${roleLabel(input.actor.role)}`,
        detail: { reason },
        at: input.now,
      }));
      return { replayed: false };
    }));
}

/**
 * Move a booking to a new slot. The original row is kept with status
 * `rescheduled`; a new row points back to it, so history is never lost.
 */
export async function rescheduleAppointment(
  db: DbOrTx,
  input: {
    appointmentId: string;
    interviewerId: string;
    startsAt: string;
    idempotencyKey?: string;
    actor: Actor;
    now: Date;
  },
): Promise<BookResult> {
  try {
    return (await inTx(db, async (tx) => {
        if (input.idempotencyKey) {
          const prior = (await tx
            .select()
            .from(appointments)
            .where(eq(appointments.idempotencyKey, input.idempotencyKey))
            .get());
          if (prior) return { appointmentId: prior.id, attemptId: prior.attemptId, replayed: true };
        }
        const old = (await loadScheduled(tx, input.appointmentId));
        assertActorMayTouch(old, input.actor);
        assertAppointmentTransition(old.status, "rescheduled");
        if (input.actor.role === "student") {
          if (!canStudentChange(old.startsAt, input.now))
            throw new DomainError(
              "CHANGE_WINDOW_CLOSED",
              `Interviews can be rescheduled up to ${POLICY.changeCutoffMinutes / 60} hours before they start. Please contact the GRIT interview team.`,
            );
          const used = (await tx
            .select({ n: sql<number>`count(*)` })
            .from(appointments)
            .where(and(eq(appointments.attemptId, old.attemptId), eq(appointments.status, "rescheduled")))
            .get());
          if ((used?.n ?? 0) >= POLICY.maxReschedulesPerAttempt)
            throw new DomainError(
              "RESCHEDULE_LIMIT",
              `This interview has already been rescheduled ${POLICY.maxReschedulesPerAttempt} times. Please contact the GRIT interview team.`,
            );
        }
        if (old.interviewerId === input.interviewerId && old.startsAt === input.startsAt)
          throw new DomainError("SAME_SLOT", "That is your current slot. Choose a different time to reschedule.");

        const { interviewer, endIso } = (await assertSlotBookable(tx, {
          interviewerId: input.interviewerId,
          startsAt: input.startsAt,
          studentId: old.studentId,
          now: input.now,
          ignoreAppointmentId: old.id,
        }));
        const nowIso = input.now.toISOString();
        (await tx.update(appointments)
          .set({ status: "rescheduled", closedBy: input.actor.role, updatedAt: nowIso })
          .where(eq(appointments.id, old.id))
          .run());
        const appointmentId = newId("apt");
        (await tx.insert(appointments)
          .values({
            id: appointmentId,
            attemptId: old.attemptId,
            studentId: old.studentId,
            badgeId: old.badgeId,
            interviewerId: interviewer.id,
            startsAt: input.startsAt,
            endsAt: endIso,
            status: "scheduled",
            bookedAt: nowIso,
            updatedAt: nowIso,
            rescheduledFromId: old.id,
            idempotencyKey: input.idempotencyKey ?? null,
          })
          .run());
        (await audit(tx, {
          entityType: "appointment",
          entityId: old.id,
          studentId: old.studentId,
          badgeId: old.badgeId,
          eventType: "appointment.rescheduled",
          fromState: "scheduled",
          toState: "rescheduled",
          actor: input.actor,
          summary: `Interview moved from ${fmtDateTime(old.startsAt)} to ${fmtDateTime(input.startsAt)} (${interviewer.name})`,
          detail: { replacedBy: appointmentId, from: old.startsAt, to: input.startsAt },
          at: input.now,
        }));
        (await audit(tx, {
          entityType: "appointment",
          entityId: appointmentId,
          studentId: old.studentId,
          badgeId: old.badgeId,
          eventType: "appointment.booked",
          fromState: "unbooked",
          toState: "scheduled",
          actor: input.actor,
          summary: `Replacement interview booked with ${interviewer.name} for ${fmtDateTime(input.startsAt)}`,
          detail: { rescheduledFrom: old.id },
          at: input.now,
        }));
        return { appointmentId, attemptId: old.attemptId, replayed: false };
      }));
  } catch (e) {
    if (isUniqueViolation(e))
      throw new DomainError("SLOT_TAKEN", "Someone just booked that slot. Please pick another time.");
    throw e;
  }
}

/** Interviewer confirms the interview happened: appointment -> completed, attempt -> awaiting_outcome. */
export async function markConducted(db: DbOrTx, input: { appointmentId: string; actor: Actor; now: Date }): Promise<{ replayed: boolean }> {
  return (await inTx(db, async (tx) => {
      const appt = (await loadScheduled(tx, input.appointmentId));
      assertActorMayTouch(appt, input.actor);
      if (input.actor.role === "student") throw new DomainError("FORBIDDEN", "Students cannot update interview status.");
      if (appt.status === "completed") return { replayed: true };
      (await completeAppointment(tx, appt, input.actor, input.now));
      return { replayed: false };
    }));
}

/** Shared by markConducted and recordOutcome. Caller must hold the transaction. */
export async function completeAppointment(
  tx: Tx,
  appt: typeof appointments.$inferSelect,
  actor: Actor,
  now: Date,
) {
  assertAppointmentTransition(appt.status, "completed");
  if (now < new Date(appt.startsAt))
    throw new DomainError("TOO_EARLY", "This interview has not started yet, so it cannot be marked as conducted.");
  const attempt = (await tx.select().from(interviewAttempts).where(eq(interviewAttempts.id, appt.attemptId)).get());
  if (!attempt) throw new DomainError("NOT_FOUND", "Attempt not found.");
  assertAttemptTransition(attempt.status, "awaiting_outcome");
  const nowIso = now.toISOString();
  (await tx.update(appointments).set({ status: "completed", updatedAt: nowIso }).where(eq(appointments.id, appt.id)).run());
  (await tx.update(interviewAttempts).set({ status: "awaiting_outcome" }).where(eq(interviewAttempts.id, attempt.id)).run());
  (await audit(tx, {
    entityType: "appointment",
    entityId: appt.id,
    studentId: appt.studentId,
    badgeId: appt.badgeId,
    eventType: "appointment.completed",
    fromState: "scheduled",
    toState: "completed",
    actor,
    summary: "Interview marked as conducted",
    at: now,
  }));
  (await audit(tx, {
    entityType: "attempt",
    entityId: attempt.id,
    studentId: appt.studentId,
    badgeId: appt.badgeId,
    eventType: "attempt.awaiting_outcome",
    fromState: "awaiting_interview",
    toState: "awaiting_outcome",
    actor,
    summary: `Attempt ${attempt.attemptNo} is awaiting its outcome`,
    at: now,
  }));
}

/**
 * No-show policy (prototype): neither kind of absence counts as an outcome.
 * The appointment is closed, the attempt stays open and the student may book
 * again. Student no-shows remain visible to the interview team.
 */
export async function markAbsence(
  db: DbOrTx,
  input: { appointmentId: string; kind: "no_show" | "interviewer_absent"; note?: string; actor: Actor; now: Date },
): Promise<{ replayed: boolean }> {
  return (await inTx(db, async (tx) => {
      const appt = (await loadScheduled(tx, input.appointmentId));
      assertActorMayTouch(appt, input.actor);
      if (input.actor.role === "student") throw new DomainError("FORBIDDEN", "Students cannot record attendance.");
      if (input.kind === "interviewer_absent" && input.actor.role !== "team")
        throw new DomainError("FORBIDDEN", "Only the interview team can record an interviewer absence.");
      if (appt.status === input.kind) return { replayed: true };
      assertAppointmentTransition(appt.status, input.kind);
      const earliest = Date.parse(appt.startsAt) + POLICY.noShowGraceMinutes * 60_000;
      if (input.now.getTime() < earliest)
        throw new DomainError(
          "TOO_EARLY",
          `Attendance can be recorded ${POLICY.noShowGraceMinutes} minutes after the scheduled start.`,
        );
      (await tx.update(appointments)
        .set({
          status: input.kind,
          closedBy: input.actor.role,
          closeReason: input.note?.trim() || null,
          updatedAt: input.now.toISOString(),
        })
        .where(eq(appointments.id, appt.id))
        .run());
      (await audit(tx, {
        entityType: "appointment",
        entityId: appt.id,
        studentId: appt.studentId,
        badgeId: appt.badgeId,
        eventType: input.kind === "no_show" ? "appointment.no_show" : "appointment.interviewer_absent",
        fromState: "scheduled",
        toState: input.kind,
        actor: input.actor,
        summary:
          input.kind === "no_show"
            ? "Student did not attend - attempt left open for re-booking"
            : "Interviewer did not attend - attempt left open for re-booking",
        detail: { note: input.note?.trim() || null },
        at: input.now,
      }));
      return { replayed: false };
    }));
}

export const roleLabel = (role: Actor["role"]) =>
  ({ student: "the student", interviewer: "the interviewer", team: "the interview team", system: "the system" })[role];

/** Scheduled appointments of one interviewer inside [from, to), soonest first. */
export async function scheduledBetween(tx: DbOrTx, interviewerId: string, fromIso: string, toIso: string) {
  return (await tx
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.interviewerId, interviewerId),
        eq(appointments.status, "scheduled"),
        lt(appointments.startsAt, toIso),
        gt(appointments.endsAt, fromIso),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .all());
}
