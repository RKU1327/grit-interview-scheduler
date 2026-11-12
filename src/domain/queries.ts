import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  appointments,
  attemptOutcomes,
  auditEvents,
  badgeAwards,
  badgeEligibilities,
  badgeNullifications,
  interviewAttempts,
  interviewers,
  students,
  trackBadges,
  type AppointmentStatus,
  type Outcome,
} from "@/db/schema";
import { dayRange } from "@/lib/time";
import { loadBadgeContext } from "./core";
import { canStudentChange, JOURNEY_STATES, POLICY, studentChangeDeadline, type JourneyState } from "./policy";

// ---------------------------------------------------------------- appointments

const apptColumns = {
  id: appointments.id,
  attemptId: appointments.attemptId,
  attemptNo: interviewAttempts.attemptNo,
  attemptStatus: interviewAttempts.status,
  studentId: appointments.studentId,
  studentName: students.name,
  studentEmail: students.email,
  badgeId: appointments.badgeId,
  badgeName: trackBadges.name,
  badgeSlug: trackBadges.slug,
  interviewerId: appointments.interviewerId,
  interviewerName: interviewers.name,
  startsAt: appointments.startsAt,
  endsAt: appointments.endsAt,
  status: appointments.status,
  bookedAt: appointments.bookedAt,
  updatedAt: appointments.updatedAt,
  closedBy: appointments.closedBy,
  closeReason: appointments.closeReason,
  rescheduledFromId: appointments.rescheduledFromId,
};

export function listAppointments(db: DbOrTx, where?: SQL, order: "asc" | "desc" = "asc") {
  const rows = db
    .select(apptColumns)
    .from(appointments)
    .innerJoin(interviewAttempts, eq(interviewAttempts.id, appointments.attemptId))
    .innerJoin(students, eq(students.id, appointments.studentId))
    .innerJoin(trackBadges, eq(trackBadges.id, appointments.badgeId))
    .innerJoin(interviewers, eq(interviewers.id, appointments.interviewerId))
    .where(where)
    .orderBy(order === "asc" ? asc(appointments.startsAt) : desc(appointments.startsAt))
    .all();
  if (rows.length === 0) return [];
  const outcomes = db
    .select({ appointmentId: attemptOutcomes.appointmentId, outcome: attemptOutcomes.outcome })
    .from(attemptOutcomes)
    .where(and(eq(attemptOutcomes.isCurrent, true), inArray(attemptOutcomes.appointmentId, rows.map((r) => r.id))))
    .all();
  const byAppt = new Map(outcomes.map((o) => [o.appointmentId, o.outcome]));
  return rows.map((r) => ({ ...r, outcome: (byAppt.get(r.id) ?? null) as Outcome | null }));
}

export type AppointmentView = ReturnType<typeof listAppointments>[number];

/** Display phase of an appointment: adds "outcome pending" on top of the stored status. */
export type AppointmentPhase = AppointmentStatus | "in_progress" | "outcome_pending";
export function appointmentPhase(a: Pick<AppointmentView, "status" | "startsAt" | "endsAt" | "outcome">, now: Date): AppointmentPhase {
  if (a.status === "scheduled") {
    if (now >= new Date(a.endsAt)) return "outcome_pending";
    if (now >= new Date(a.startsAt)) return "in_progress";
    return "scheduled";
  }
  if (a.status === "completed" && !a.outcome) return "outcome_pending";
  return a.status;
}

// ---------------------------------------------------------------- student views

export function getStudentBadgeView(db: DbOrTx, studentId: string, badgeId: string, now: Date) {
  const badge = db.select().from(trackBadges).where(eq(trackBadges.id, badgeId)).get();
  if (!badge) return null;
  const ctx = loadBadgeContext(db, studentId, badgeId, now);
  const appts = listAppointments(db, and(eq(appointments.studentId, studentId), eq(appointments.badgeId, badgeId)), "desc");
  const outcomes = ctx.attempts.length
    ? db
        .select({
          id: attemptOutcomes.id,
          attemptId: attemptOutcomes.attemptId,
          outcome: attemptOutcomes.outcome,
          recordedAt: attemptOutcomes.recordedAt,
          isCurrent: attemptOutcomes.isCurrent,
          correctionReason: attemptOutcomes.correctionReason,
        })
        .from(attemptOutcomes)
        .where(inArray(attemptOutcomes.attemptId, ctx.attempts.map((a) => a.id)))
        .orderBy(asc(attemptOutcomes.recordedAt))
        .all()
    : [];
  const attempts = [...ctx.attempts].reverse().map((a) => ({
    ...a,
    appointments: appts.filter((p) => p.attemptId === a.id),
    // Students see the outcome and when it was published - never private notes.
    outcome: outcomes.find((o) => o.attemptId === a.id && o.isCurrent) ?? null,
    wasCorrected: outcomes.filter((o) => o.attemptId === a.id).length > 1,
  }));
  const nullification = ctx.award
    ? (db.select().from(badgeNullifications).where(eq(badgeNullifications.awardId, ctx.award.id)).get() ?? null)
    : null;
  const active = appts.find((p) => p.status === "scheduled") ?? null;
  const reschedulesUsed = active
    ? appts.filter((p) => p.attemptId === active.attemptId && p.status === "rescheduled").length
    : 0;
  return {
    badge,
    skills: ctx.required,
    progress: ctx.progress,
    eligibleAt: ctx.eligibility?.eligibleAt ?? null,
    journey: ctx.journey,
    gate: ctx.gate,
    activeAppointment: active,
    change: active
      ? {
          allowed: canStudentChange(active.startsAt, now),
          deadline: studentChangeDeadline(active.startsAt).toISOString(),
          reschedulesLeft: Math.max(0, POLICY.maxReschedulesPerAttempt - reschedulesUsed),
        }
      : null,
    attempts,
    lastFinal: attempts.find((a) => a.outcome) ?? null,
    award: ctx.award,
    nullifiedAt: nullification?.createdAt ?? null,
    retakeAvailableAt: ctx.lastFinal?.status === "retake_later" ? ctx.lastFinal.retakeAvailableAt : null,
    hasGrant: ctx.unusedGrant !== null,
  };
}

export type StudentBadgeView = NonNullable<ReturnType<typeof getStudentBadgeView>>;

export function getStudentBadgeViews(db: DbOrTx, studentId: string, now: Date): StudentBadgeView[] {
  const badges = db.select().from(trackBadges).orderBy(asc(trackBadges.name)).all();
  const order = (v: StudentBadgeView) => (v.journey === "locked" ? (v.progress.clearedCount === 0 ? 2 : 1) : 0);
  return badges
    .map((b) => getStudentBadgeView(db, studentId, b.id, now)!)
    .sort((a, b) => order(a) - order(b) || b.progress.clearedCount - a.progress.clearedCount);
}

// ---------------------------------------------------------------- team views

export const NEXT_ACTION: Record<JourneyState, string> = {
  locked: "Not eligible yet",
  eligible_unbooked: "Nudge student to book",
  booked: "None - interview scheduled",
  awaiting_outcome: "Chase interviewer for outcome",
  passed: "None - badge earned",
  failed: "Decide whether to open a new attempt",
  retake_later: "Student to re-book",
  nullified: "Closed - badge nullified",
};

export function getRoster(db: DbOrTx, now: Date) {
  const rows = db
    .select({
      eligibilityId: badgeEligibilities.id,
      eligibleAt: badgeEligibilities.eligibleAt,
      studentId: students.id,
      studentName: students.name,
      studentEmail: students.email,
      cohort: students.cohort,
      badgeId: trackBadges.id,
      badgeName: trackBadges.name,
      badgeSlug: trackBadges.slug,
    })
    .from(badgeEligibilities)
    .innerJoin(students, eq(students.id, badgeEligibilities.studentId))
    .innerJoin(trackBadges, eq(trackBadges.id, badgeEligibilities.badgeId))
    .orderBy(desc(badgeEligibilities.eligibleAt))
    .all();
  const interviewerNames = new Map(db.select().from(interviewers).all().map((i) => [i.id, i.name]));
  return rows.map((r) => {
    const ctx = loadBadgeContext(db, r.studentId, r.badgeId, now);
    let nextAction = NEXT_ACTION[ctx.journey];
    if (ctx.journey === "failed" && ctx.unusedGrant) nextAction = "New attempt opened - student to book";
    if (ctx.journey === "retake_later" && !ctx.gate.allowed) nextAction = "Waiting for retake window to open";
    if (ctx.journey === "eligible_unbooked" && ctx.openAttempt) nextAction = "Nudge student to re-book";
    return {
      ...r,
      journey: ctx.journey,
      canBook: ctx.gate.allowed,
      attemptCount: ctx.attempts.length,
      lastFinalStatus: ctx.lastFinal?.status ?? null,
      retakeAvailableAt: ctx.lastFinal?.retakeAvailableAt ?? null,
      hasGrant: ctx.unusedGrant !== null,
      scheduled: ctx.scheduled
        ? {
            id: ctx.scheduled.id,
            startsAt: ctx.scheduled.startsAt,
            endsAt: ctx.scheduled.endsAt,
            interviewerName: interviewerNames.get(ctx.scheduled.interviewerId) ?? "",
          }
        : null,
      awardId: ctx.award?.id ?? null,
      nextAction,
    };
  });
}

export type RosterRow = ReturnType<typeof getRoster>[number];

export function getOverview(db: DbOrTx, now: Date) {
  const roster = getRoster(db, now);
  const byJourney = Object.fromEntries(JOURNEY_STATES.map((s) => [s, 0])) as Record<JourneyState, number>;
  for (const r of roster) byJourney[r.journey] += 1;
  const outcomeRows = db
    .select({ outcome: attemptOutcomes.outcome, n: sql<number>`count(*)` })
    .from(attemptOutcomes)
    .where(eq(attemptOutcomes.isCurrent, true))
    .groupBy(attemptOutcomes.outcome)
    .all();
  const outcomes: Record<Outcome, number> = { pass: 0, fail: 0, retake_later: 0 };
  for (const o of outcomeRows) outcomes[o.outcome] = o.n;
  const awards = db
    .select({ status: badgeAwards.status, n: sql<number>`count(*)` })
    .from(badgeAwards)
    .groupBy(badgeAwards.status)
    .all();
  const count = (status: AppointmentStatus) =>
    db.select({ n: sql<number>`count(*)` }).from(appointments).where(eq(appointments.status, status)).get()?.n ?? 0;
  const pending = listAppointments(
    db,
    or(
      and(eq(appointments.status, "scheduled"), lt(appointments.startsAt, now.toISOString())),
      and(eq(appointments.status, "completed"), eq(interviewAttempts.status, "awaiting_outcome")),
    ),
  );
  const upcoming = listAppointments(
    db,
    and(eq(appointments.status, "scheduled"), gte(appointments.startsAt, now.toISOString())),
  );
  return {
    eligible: roster.length,
    unbooked: byJourney.eligible_unbooked,
    booked: byJourney.booked,
    outcomePending: byJourney.awaiting_outcome,
    completed: outcomes.pass + outcomes.fail + outcomes.retake_later,
    byJourney,
    outcomes,
    badgesActive: awards.find((a) => a.status === "active")?.n ?? 0,
    badgesNullified: awards.find((a) => a.status === "nullified")?.n ?? 0,
    noShows: count("no_show"),
    cancelled: count("cancelled"),
    pending,
    upcoming,
    unbookedRows: roster.filter((r) => r.journey === "eligible_unbooked"),
  };
}

export function getAppointmentDetail(db: DbOrTx, appointmentId: string) {
  const appt = listAppointments(db, eq(appointments.id, appointmentId))[0];
  if (!appt) return null;
  const outcomes = db
    .select()
    .from(attemptOutcomes)
    .where(eq(attemptOutcomes.attemptId, appt.attemptId))
    .orderBy(desc(attemptOutcomes.recordedAt))
    .all();
  const siblings = listAppointments(db, eq(appointments.attemptId, appt.attemptId), "desc");
  const priorAttempts = db
    .select()
    .from(interviewAttempts)
    .where(and(eq(interviewAttempts.studentId, appt.studentId), eq(interviewAttempts.badgeId, appt.badgeId)))
    .orderBy(asc(interviewAttempts.attemptNo))
    .all();
  const award = db.select().from(badgeAwards).where(eq(badgeAwards.attemptId, appt.attemptId)).get() ?? null;
  const ids = [appt.attemptId, ...siblings.map((s) => s.id), ...outcomes.map((o) => o.id), ...(award ? [award.id] : [])];
  const events = db
    .select()
    .from(auditEvents)
    .where(inArray(auditEvents.entityId, ids))
    .orderBy(desc(auditEvents.createdAt), desc(sql`rowid`))
    .all();
  return { appt, outcomes, siblings, priorAttempts, award, events };
}

export function getDaySchedule(db: DbOrTx, interviewerId: string, day: string) {
  const { start, end } = dayRange(day);
  return listAppointments(
    db,
    and(
      eq(appointments.interviewerId, interviewerId),
      gte(appointments.startsAt, start.toISOString()),
      lt(appointments.startsAt, end.toISOString()),
    ),
  );
}

export function listAwards(db: DbOrTx) {
  return db
    .select({
      id: badgeAwards.id,
      status: badgeAwards.status,
      awardedAt: badgeAwards.awardedAt,
      attemptId: badgeAwards.attemptId,
      studentId: students.id,
      studentName: students.name,
      badgeName: trackBadges.name,
      nullifiedAt: badgeNullifications.createdAt,
      nullifyReason: badgeNullifications.reason,
      nullifiedBy: badgeNullifications.confirmedByName,
    })
    .from(badgeAwards)
    .innerJoin(students, eq(students.id, badgeAwards.studentId))
    .innerJoin(trackBadges, eq(trackBadges.id, badgeAwards.badgeId))
    .leftJoin(badgeNullifications, eq(badgeNullifications.awardId, badgeAwards.id))
    .orderBy(desc(badgeAwards.awardedAt))
    .all();
}

export function listAudit(db: DbOrTx, opts: { studentId?: string; limit?: number } = {}) {
  return db
    .select()
    .from(auditEvents)
    .where(opts.studentId ? eq(auditEvents.studentId, opts.studentId) : undefined)
    .orderBy(desc(auditEvents.createdAt), desc(sql`rowid`))
    .limit(opts.limit ?? 200)
    .all();
}

export type AuditRow = ReturnType<typeof listAudit>[number];
