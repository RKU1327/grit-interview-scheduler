import { and, eq, gt } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  appointments,
  attemptOutcomes,
  badgeAwards,
  interviewAttempts,
  students,
  trackBadges,
  type Outcome,
} from "@/db/schema";
import { addDays } from "@/lib/time";
import { audit, inTx, newId, type Actor } from "./core";
import { completeAppointment } from "./booking";
import {
  assertAttemptTransition,
  canCorrectAttempt,
  DomainError,
  humanize,
  isFinalAttempt,
  OUTCOME_TO_STATUS,
  POLICY,
  STATUS_TO_OUTCOME,
} from "./policy";

export const OUTCOME_LABEL: Record<Outcome, string> = { pass: "Pass", fail: "Fail", retake_later: "Retake later" };

/**
 * Record the result of an interview. Guards, in order:
 *  - only the assigned interviewer or the interview team may record
 *  - the appointment must be scheduled/completed (never cancelled, no-show...)
 *  - the interview must have started
 *  - a finalised attempt cannot be overwritten: an identical replay is a
 *    no-op, anything else is rejected and must go through `correctOutcome`
 * A pass issues the badge award in the same transaction.
 */
export async function recordOutcome(
  db: DbOrTx,
  input: {
    appointmentId: string;
    outcome: Outcome;
    privateNotes?: string;
    retakeWaitDays?: number;
    actor: Actor;
    now: Date;
  },
): Promise<{ attemptId: string; awardId: string | null; replayed: boolean }> {
  return (await inTx(db, async (tx) => {
    if (input.actor.role !== "interviewer" && input.actor.role !== "team")
      throw new DomainError("FORBIDDEN", "Only interviewers and the interview team can record outcomes.");
    const appt = (await tx.select().from(appointments).where(eq(appointments.id, input.appointmentId)).get());
    if (!appt) throw new DomainError("NOT_FOUND", "That appointment does not exist.");
    if (input.actor.role === "interviewer" && input.actor.id !== appt.interviewerId)
      throw new DomainError("FORBIDDEN", "This interview is assigned to a different interviewer.");
    const attempt = (await tx.select().from(interviewAttempts).where(eq(interviewAttempts.id, appt.attemptId)).get());
    if (!attempt) throw new DomainError("NOT_FOUND", "Attempt not found.");

    if (isFinalAttempt(attempt.status)) {
      const current = (await tx
        .select()
        .from(attemptOutcomes)
        .where(and(eq(attemptOutcomes.attemptId, attempt.id), eq(attemptOutcomes.isCurrent, true)))
        .get());
      if (current && current.appointmentId === appt.id && current.outcome === input.outcome) {
        const award = (await tx.select().from(badgeAwards).where(eq(badgeAwards.attemptId, attempt.id)).get());
        return { attemptId: attempt.id, awardId: award?.id ?? null, replayed: true };
      }
      throw new DomainError(
        "OUTCOME_FINAL",
        `This attempt already has a final outcome (${humanize(attempt.status)}). It cannot be overwritten - the interview team can issue a correction with a reason.`,
      );
    }
    if (appt.status !== "scheduled" && appt.status !== "completed")
      throw new DomainError(
        "INVALID_STATE",
        `An outcome cannot be recorded for an appointment that is ${humanize(appt.status)}.`,
      );
    if (input.now < new Date(appt.startsAt))
      throw new DomainError("TOO_EARLY", "This interview has not started yet. Outcomes can be recorded from its start time.");

    if (appt.status === "scheduled") (await completeAppointment(tx, appt, input.actor, input.now));
    const target = OUTCOME_TO_STATUS[input.outcome];
    assertAttemptTransition("awaiting_outcome", target);

    const student = (await tx.select().from(students).where(eq(students.id, appt.studentId)).get());
    const badge = (await tx.select().from(trackBadges).where(eq(trackBadges.id, appt.badgeId)).get());
    const nowIso = input.now.toISOString();
    const waitDays =
      input.outcome === "retake_later"
        ? Math.max(0, Math.min(60, Math.round(input.retakeWaitDays ?? POLICY.defaultRetakeWaitDays)))
        : null;
    const retakeAvailableAt = waitDays === null ? null : addDays(input.now, waitDays).toISOString();

    const outcomeId = newId("out");
    (await tx.insert(attemptOutcomes)
      .values({
        id: outcomeId,
        attemptId: attempt.id,
        appointmentId: appt.id,
        outcome: input.outcome,
        privateNotes: input.privateNotes?.trim() || null,
        recordedByRole: input.actor.role,
        recordedById: input.actor.id,
        recordedByName: input.actor.name,
        recordedAt: nowIso,
        isCurrent: true,
      })
      .run());
    (await tx.update(interviewAttempts)
      .set({ status: target, closedAt: nowIso, retakeAvailableAt })
      .where(eq(interviewAttempts.id, attempt.id))
      .run());
    (await audit(tx, {
      entityType: "outcome",
      entityId: outcomeId,
      studentId: appt.studentId,
      badgeId: appt.badgeId,
      eventType: "outcome.recorded",
      fromState: "awaiting_outcome",
      toState: target,
      actor: input.actor,
      summary: `Outcome recorded: ${OUTCOME_LABEL[input.outcome]} (attempt ${attempt.attemptNo})`,
      detail: { attemptId: attempt.id, appointmentId: appt.id, retakeAvailableAt },
      at: input.now,
    }));

    let awardId: string | null = null;
    if (input.outcome === "pass") {
      awardId = (await issueAward(tx, {
        studentId: appt.studentId,
        badgeId: appt.badgeId,
        attemptId: attempt.id,
        studentName: student?.name ?? "Student",
        badgeName: badge?.name ?? "badge",
        actor: input.actor,
        now: input.now,
      }));
    }
    return { attemptId: attempt.id, awardId, replayed: false };
  }));
}

async function issueAward(
  tx: DbOrTx,
  i: { studentId: string; badgeId: string; attemptId: string; studentName: string; badgeName: string; actor: Actor; now: Date },
) {
  const awardId = newId("awd");
  (await tx.insert(badgeAwards)
    .values({
      id: awardId,
      studentId: i.studentId,
      badgeId: i.badgeId,
      attemptId: i.attemptId,
      status: "active",
      awardedAt: i.now.toISOString(),
    })
    .run());
  (await audit(tx, {
    entityType: "award",
    entityId: awardId,
    studentId: i.studentId,
    badgeId: i.badgeId,
    eventType: "badge.awarded",
    fromState: "not_earned",
    toState: "earned",
    actor: i.actor,
    summary: `${i.badgeName} awarded to ${i.studentName}`,
    detail: { attemptId: i.attemptId },
    at: i.now,
  }));
  return awardId;
}

/**
 * Authorised correction of a finalised outcome (interview team only). The old
 * outcome row is kept and marked superseded; a new row carries the reason.
 */
export async function correctOutcome(
  db: DbOrTx,
  input: { attemptId: string; outcome: Outcome; reason: string; retakeWaitDays?: number; actor: Actor; now: Date },
): Promise<{ outcomeId: string; awardId: string | null }> {
  return (await inTx(db, async (tx) => {
    if (input.actor.role !== "team")
      throw new DomainError("FORBIDDEN", "Only the interview team can correct a finalised outcome.");
    const reason = input.reason.trim();
    if (reason.length < POLICY.minReasonLength)
      throw new DomainError("REASON_REQUIRED", `Give a reason of at least ${POLICY.minReasonLength} characters.`);
    const attempt = (await tx.select().from(interviewAttempts).where(eq(interviewAttempts.id, input.attemptId)).get());
    if (!attempt) throw new DomainError("NOT_FOUND", "Attempt not found.");
    const target = OUTCOME_TO_STATUS[input.outcome];
    if (attempt.status === target) throw new DomainError("NO_CHANGE", "That is already the recorded outcome.");
    if (!canCorrectAttempt(attempt.status, target))
      throw new DomainError(
        "INVALID_CORRECTION",
        attempt.status === "passed"
          ? "A pass cannot be corrected away. If malpractice is confirmed, nullify the badge instead."
          : `An attempt that is ${humanize(attempt.status)} has no outcome to correct.`,
      );
    const later = (await tx
      .select({ id: interviewAttempts.id })
      .from(interviewAttempts)
      .where(
        and(
          eq(interviewAttempts.studentId, attempt.studentId),
          eq(interviewAttempts.badgeId, attempt.badgeId),
          gt(interviewAttempts.attemptNo, attempt.attemptNo),
        ),
      )
      .get());
    if (later)
      throw new DomainError("SUPERSEDED_ATTEMPT", "A newer attempt exists for this badge, so this outcome can no longer be corrected.");
    const current = (await tx
      .select()
      .from(attemptOutcomes)
      .where(and(eq(attemptOutcomes.attemptId, attempt.id), eq(attemptOutcomes.isCurrent, true)))
      .get());
    if (!current) throw new DomainError("NOT_FOUND", "No current outcome to correct.");

    const nowIso = input.now.toISOString();
    const retakeAvailableAt =
      input.outcome === "retake_later"
        ? addDays(input.now, Math.max(0, input.retakeWaitDays ?? POLICY.defaultRetakeWaitDays)).toISOString()
        : null;
    (await tx.update(attemptOutcomes).set({ isCurrent: false }).where(eq(attemptOutcomes.id, current.id)).run());
    const outcomeId = newId("out");
    (await tx.insert(attemptOutcomes)
      .values({
        id: outcomeId,
        attemptId: attempt.id,
        appointmentId: current.appointmentId,
        outcome: input.outcome,
        recordedByRole: input.actor.role,
        recordedById: input.actor.id,
        recordedByName: input.actor.name,
        recordedAt: nowIso,
        isCurrent: true,
        supersedesId: current.id,
        correctionReason: reason,
      })
      .run());
    (await tx.update(interviewAttempts)
      .set({ status: target, retakeAvailableAt })
      .where(eq(interviewAttempts.id, attempt.id))
      .run());
    (await audit(tx, {
      entityType: "outcome",
      entityId: outcomeId,
      studentId: attempt.studentId,
      badgeId: attempt.badgeId,
      eventType: "outcome.corrected",
      fromState: attempt.status,
      toState: target,
      actor: input.actor,
      summary: `Outcome corrected from ${OUTCOME_LABEL[STATUS_TO_OUTCOME[attempt.status]!]} to ${OUTCOME_LABEL[input.outcome]}`,
      detail: { reason, supersedes: current.id, attemptId: attempt.id },
      at: input.now,
    }));
    let awardId: string | null = null;
    if (input.outcome === "pass") {
      const student = (await tx.select().from(students).where(eq(students.id, attempt.studentId)).get());
      const badge = (await tx.select().from(trackBadges).where(eq(trackBadges.id, attempt.badgeId)).get());
      awardId = (await issueAward(tx, {
        studentId: attempt.studentId,
        badgeId: attempt.badgeId,
        attemptId: attempt.id,
        studentName: student?.name ?? "Student",
        badgeName: badge?.name ?? "badge",
        actor: input.actor,
        now: input.now,
      }));
    }
    return { outcomeId, awardId };
  }));
}
