import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Conventions
 * - Every timestamp is an ISO-8601 UTC string (e.g. 2026-11-14T04:30:00.000Z).
 *   ISO strings in UTC sort lexicographically, so range queries are plain
 *   string comparisons. Display converts to Asia/Kolkata at the edge.
 * - Time ranges are half-open: [starts_at, ends_at).
 * - Four lifecycles are stored separately and never collapsed into one enum:
 *   eligibility, appointment, attempt/outcome, badge award.
 */

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "rescheduled",
  "no_show",
  "interviewer_absent",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const ATTEMPT_STATUSES = [
  "awaiting_interview",
  "awaiting_outcome",
  "passed",
  "failed",
  "retake_later",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const OUTCOMES = ["pass", "fail", "retake_later"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const AWARD_STATUSES = ["active", "nullified"] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];

export const ACTOR_ROLES = ["student", "interviewer", "team", "system"] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

export const students = sqliteTable("students", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  cohort: text("cohort").notNull(),
  createdAt: text("created_at").notNull(),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const trackBadges = sqliteTable("track_badges", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  track: text("track").notNull(),
  tier: text("tier").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  interviewMinutes: integer("interview_minutes").notNull().default(30),
});

export const badgeSkillRequirements = sqliteTable(
  "badge_skill_requirements",
  {
    badgeId: text("badge_id")
      .notNull()
      .references(() => trackBadges.id),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
  },
  (t) => [primaryKey({ columns: [t.badgeId, t.skillId] })],
);

export const studentSkillCompletions = sqliteTable(
  "student_skill_completions",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    clearedAt: text("cleared_at").notNull(),
    source: text("source").notNull().default("skill_contest"),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.skillId] })],
);

/**
 * Eligibility is derived (all required skills cleared) but the moment it was
 * first reached is snapshotted here so the roster can show "eligible since"
 * and so later requirement changes cannot silently un-earn an interview.
 */
export const badgeEligibilities = sqliteTable(
  "badge_eligibilities",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    badgeId: text("badge_id")
      .notNull()
      .references(() => trackBadges.id),
    eligibleAt: text("eligible_at").notNull(),
  },
  (t) => [uniqueIndex("uq_eligibility_student_badge").on(t.studentId, t.badgeId)],
);

export const interviewers = sqliteTable("interviewers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/** Open time an interviewer offers. Overlap between an interviewer's own
 *  windows is rejected in the service layer inside a write transaction. */
export const availabilityWindows = sqliteTable(
  "availability_windows",
  {
    id: text("id").primaryKey(),
    interviewerId: text("interviewer_id")
      .notNull()
      .references(() => interviewers.id),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("ix_window_interviewer_start").on(t.interviewerId, t.startsAt),
    check("ck_window_range", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/**
 * One attempt = one go at the badge interview that ends in exactly one current
 * outcome. An attempt can own several appointments over time (reschedules,
 * cancellations, no-shows) but only one of them may be `scheduled`.
 */
export const interviewAttempts = sqliteTable(
  "interview_attempts",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    badgeId: text("badge_id")
      .notNull()
      .references(() => trackBadges.id),
    attemptNo: integer("attempt_no").notNull(),
    status: text("status", { enum: ATTEMPT_STATUSES }).notNull(),
    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),
    /** Only set for retake_later: earliest moment a new attempt may be booked. */
    retakeAvailableAt: text("retake_available_at"),
  },
  (t) => [
    uniqueIndex("uq_attempt_number").on(t.studentId, t.badgeId, t.attemptNo),
    // At most one open attempt per student per badge.
    uniqueIndex("uq_attempt_one_open")
      .on(t.studentId, t.badgeId)
      .where(sql`status in ('awaiting_interview', 'awaiting_outcome')`),
    check("ck_attempt_status", sql`${t.status} in (${inList(ATTEMPT_STATUSES)})`),
    check("ck_attempt_no", sql`${t.attemptNo} >= 1`),
  ],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => interviewAttempts.id),
    // student/badge are denormalised from the attempt so that the uniqueness
    // rules below can be enforced by SQLite itself.
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    badgeId: text("badge_id")
      .notNull()
      .references(() => trackBadges.id),
    interviewerId: text("interviewer_id")
      .notNull()
      .references(() => interviewers.id),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull(),
    bookedAt: text("booked_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    closedBy: text("closed_by", { enum: ACTOR_ROLES }),
    closeReason: text("close_reason"),
    /** Set on the replacement appointment created by a reschedule. */
    rescheduledFromId: text("rescheduled_from_id"),
    /** Client-generated key; a replayed submit returns the first result. */
    idempotencyKey: text("idempotency_key").unique(),
  },
  (t) => [
    // An interviewer's slot can be held by one live appointment only.
    uniqueIndex("uq_appt_interviewer_slot")
      .on(t.interviewerId, t.startsAt)
      .where(sql`status in ('scheduled', 'completed')`),
    // One live booking per attempt (=> per student per badge).
    uniqueIndex("uq_appt_one_scheduled_per_attempt")
      .on(t.attemptId)
      .where(sql`status = 'scheduled'`),
    // A student cannot be in two interviews at the same time.
    uniqueIndex("uq_appt_student_slot")
      .on(t.studentId, t.startsAt)
      .where(sql`status = 'scheduled'`),
    index("ix_appt_interviewer_start").on(t.interviewerId, t.startsAt),
    index("ix_appt_student").on(t.studentId, t.badgeId),
    index("ix_appt_status_start").on(t.status, t.startsAt),
    check("ck_appt_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("ck_appt_status", sql`${t.status} in (${inList(APPOINTMENT_STATUSES)})`),
  ],
);

/**
 * Append-only outcome ledger. A correction inserts a new row that supersedes
 * the previous one; nothing is updated in place except the `is_current` flag.
 */
export const attemptOutcomes = sqliteTable(
  "attempt_outcomes",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => interviewAttempts.id),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id),
    outcome: text("outcome", { enum: OUTCOMES }).notNull(),
    /** Private to interviewers and the interview team. Never shown to students. */
    privateNotes: text("private_notes"),
    recordedByRole: text("recorded_by_role", { enum: ACTOR_ROLES }).notNull(),
    recordedById: text("recorded_by_id").notNull(),
    recordedByName: text("recorded_by_name").notNull(),
    recordedAt: text("recorded_at").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
    supersedesId: text("supersedes_id"),
    correctionReason: text("correction_reason"),
  },
  (t) => [
    uniqueIndex("uq_outcome_one_current")
      .on(t.attemptId)
      .where(sql`is_current = 1`),
    index("ix_outcome_attempt").on(t.attemptId),
    check("ck_outcome_value", sql`${t.outcome} in (${inList(OUTCOMES)})`),
  ],
);

/** Interview-team permission for a new attempt after a failed one. */
export const attemptGrants = sqliteTable(
  "attempt_grants",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    badgeId: text("badge_id")
      .notNull()
      .references(() => trackBadges.id),
    reason: text("reason").notNull(),
    grantedById: text("granted_by_id").notNull(),
    grantedByName: text("granted_by_name").notNull(),
    createdAt: text("created_at").notNull(),
    consumedByAttemptId: text("consumed_by_attempt_id").references(
      () => interviewAttempts.id,
    ),
  },
  (t) => [
    uniqueIndex("uq_grant_one_unused")
      .on(t.studentId, t.badgeId)
      .where(sql`consumed_by_attempt_id is null`),
  ],
);

export const badgeAwards = sqliteTable(
  "badge_awards",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    badgeId: text("badge_id")
      .notNull()
      .references(() => trackBadges.id),
    /** The passed attempt that earned the badge; one award per attempt. */
    attemptId: text("attempt_id")
      .notNull()
      .unique()
      .references(() => interviewAttempts.id),
    status: text("status", { enum: AWARD_STATUSES }).notNull(),
    awardedAt: text("awarded_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_award_one_active")
      .on(t.studentId, t.badgeId)
      .where(sql`status = 'active'`),
    check("ck_award_status", sql`${t.status} in (${inList(AWARD_STATUSES)})`),
  ],
);

/** Malpractice record. The award row is kept and flipped to `nullified`. */
export const badgeNullifications = sqliteTable("badge_nullifications", {
  id: text("id").primaryKey(),
  awardId: text("award_id")
    .notNull()
    .unique()
    .references(() => badgeAwards.id),
  reason: text("reason").notNull(),
  confirmedById: text("confirmed_by_id").notNull(),
  confirmedByName: text("confirmed_by_name").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Append-only log of every state transition and notable action. */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    studentId: text("student_id"),
    badgeId: text("badge_id"),
    eventType: text("event_type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    actorRole: text("actor_role", { enum: ACTOR_ROLES }).notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    summary: text("summary").notNull(),
    /** JSON payload with event-specific detail. */
    detail: text("detail"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ix_audit_entity").on(t.entityType, t.entityId),
    index("ix_audit_student").on(t.studentId, t.createdAt),
    index("ix_audit_created").on(t.createdAt),
  ],
);

/** Demo-only key/value settings (e.g. the demo clock offset). */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
