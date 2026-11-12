import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "@/db";
import {
  appMeta,
  appointments,
  attemptGrants,
  auditEvents,
  badgeAwards,
  badgeEligibilities,
  badgeSkillRequirements,
  interviewAttempts,
  skills,
  studentSkillCompletions,
  type ActorRole,
} from "@/db/schema";
import { bookingGate, computeEligibility, deriveJourney, isFinalAttempt, isOpenAttempt } from "./policy";

export type Actor = { role: ActorRole; id: string; name: string };
export const SYSTEM_ACTOR: Actor = { role: "system", id: "system", name: "GRIT system" };

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

// ---------------------------------------------------------------- demo clock

const CLOCK_KEY = "clock_offset_ms";

export function getClockOffsetMs(db: DbOrTx): number {
  const row = db.select().from(appMeta).where(eq(appMeta.key, CLOCK_KEY)).get();
  const n = row ? Number(row.value) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** "Now" for every rule in the app. Real time plus the demo clock offset. */
export function getNow(db: DbOrTx): Date {
  return new Date(Date.now() + getClockOffsetMs(db));
}

export function setClockOffsetMs(db: DbOrTx, ms: number) {
  db.insert(appMeta)
    .values({ key: CLOCK_KEY, value: String(Math.round(ms)) })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: String(Math.round(ms)) } })
    .run();
}

// ---------------------------------------------------------------- audit trail

export type AuditInput = {
  entityType: "eligibility" | "appointment" | "attempt" | "outcome" | "award" | "availability" | "grant" | "skill";
  entityId: string;
  studentId?: string | null;
  badgeId?: string | null;
  eventType: string;
  fromState?: string | null;
  toState?: string | null;
  actor: Actor;
  summary: string;
  detail?: Record<string, unknown>;
  at: Date;
};

export function audit(tx: DbOrTx, e: AuditInput) {
  tx.insert(auditEvents)
    .values({
      id: newId("evt"),
      entityType: e.entityType,
      entityId: e.entityId,
      studentId: e.studentId ?? null,
      badgeId: e.badgeId ?? null,
      eventType: e.eventType,
      fromState: e.fromState ?? null,
      toState: e.toState ?? null,
      actorRole: e.actor.role,
      actorId: e.actor.id,
      actorName: e.actor.name,
      summary: e.summary,
      detail: e.detail ? JSON.stringify(e.detail) : null,
      createdAt: e.at.toISOString(),
    })
    .run();
}

// ---------------------------------------------------------------- badge context

/** Everything needed to decide what a student may do for one badge. */
export function loadBadgeContext(tx: DbOrTx, studentId: string, badgeId: string, now: Date) {
  const required = tx
    .select({ id: skills.id, code: skills.code, name: skills.name })
    .from(badgeSkillRequirements)
    .innerJoin(skills, eq(skills.id, badgeSkillRequirements.skillId))
    .where(eq(badgeSkillRequirements.badgeId, badgeId))
    .orderBy(asc(skills.name))
    .all();
  const completions = tx
    .select()
    .from(studentSkillCompletions)
    .where(eq(studentSkillCompletions.studentId, studentId))
    .all();
  const clearedAt = new Map(completions.map((c) => [c.skillId, c.clearedAt]));
  const progress = computeEligibility(
    required.map((s) => s.id),
    clearedAt.keys(),
  );
  const eligibility =
    tx
      .select()
      .from(badgeEligibilities)
      .where(and(eq(badgeEligibilities.studentId, studentId), eq(badgeEligibilities.badgeId, badgeId)))
      .get() ?? null;
  const attempts = tx
    .select()
    .from(interviewAttempts)
    .where(and(eq(interviewAttempts.studentId, studentId), eq(interviewAttempts.badgeId, badgeId)))
    .orderBy(asc(interviewAttempts.attemptNo))
    .all();
  const openAttempt = attempts.find((a) => isOpenAttempt(a.status)) ?? null;
  const lastFinal = [...attempts].reverse().find((a) => isFinalAttempt(a.status)) ?? null;
  const scheduled =
    tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.studentId, studentId),
          eq(appointments.badgeId, badgeId),
          eq(appointments.status, "scheduled"),
        ),
      )
      .get() ?? null;
  const award =
    tx
      .select()
      .from(badgeAwards)
      .where(and(eq(badgeAwards.studentId, studentId), eq(badgeAwards.badgeId, badgeId)))
      .orderBy(desc(badgeAwards.awardedAt))
      .get() ?? null;
  const unusedGrant =
    tx
      .select()
      .from(attemptGrants)
      .where(
        and(
          eq(attemptGrants.studentId, studentId),
          eq(attemptGrants.badgeId, badgeId),
          isNull(attemptGrants.consumedByAttemptId),
        ),
      )
      .get() ?? null;

  // Eligibility is the stored snapshot; `progress` explains it.
  const eligible = eligibility !== null;
  const gate = bookingGate({
    eligible,
    awardStatus: award?.status ?? null,
    openAttemptStatus: openAttempt?.status ?? null,
    hasScheduledAppointment: scheduled !== null,
    lastFinalStatus: lastFinal?.status ?? null,
    retakeAvailableAt: lastFinal?.retakeAvailableAt ?? null,
    hasUnusedGrant: unusedGrant !== null,
    now,
  });
  const journey = deriveJourney({
    eligible,
    awardStatus: award?.status ?? null,
    openAttemptStatus: openAttempt?.status ?? null,
    scheduledStartsAt: scheduled?.startsAt ?? null,
    lastFinalStatus: lastFinal?.status ?? null,
    now,
  });

  return {
    required: required.map((s) => ({ ...s, clearedAt: clearedAt.get(s.id) ?? null })),
    progress,
    eligibility,
    eligible,
    attempts,
    openAttempt,
    lastFinal,
    scheduled,
    award,
    unusedGrant,
    gate,
    journey,
  };
}

export type BadgeContext = ReturnType<typeof loadBadgeContext>;

/**
 * Run `fn` in one write transaction. BEGIN IMMEDIATE takes SQLite's single
 * writer lock up front, so checks and writes inside cannot interleave with
 * another writer. When called with a transaction it nests as a savepoint.
 */
export function inTx<T>(db: DbOrTx, fn: (tx: Tx) => T): T {
  return (db as Db).transaction(fn, { behavior: "immediate" });
}

export const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && String((e as { code: unknown }).code).startsWith("SQLITE_CONSTRAINT");
