import type { AppointmentStatus, AttemptStatus, AwardStatus, Outcome } from "@/db/schema";

/**
 * Prototype policy. These numbers are product decisions made for the
 * prototype so the workflow is demonstrable. They are NOT official NIAT rules.
 */
export const POLICY = {
  /** Interview slot length; availability is cut into slots of this size. */
  slotMinutes: 30,
  /** A slot must start at least this far in the future to be bookable. */
  bookingLeadMinutes: 30,
  /** Students may cancel/reschedule until this long before the start. */
  changeCutoffMinutes: 120,
  /** Student-initiated reschedules allowed per attempt. */
  maxReschedulesPerAttempt: 2,
  /** A student no-show can be recorded once the interview is this late. */
  noShowGraceMinutes: 10,
  /** Default wait before a "retake later" student can book again. */
  defaultRetakeWaitDays: 7,
  retakeWaitOptions: [0, 3, 7, 14],
  /** Minimum length of a malpractice / correction reason. */
  minReasonLength: 10,
} as const;

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ---------------------------------------------------------------- lifecycles

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ["completed", "cancelled", "rescheduled", "no_show", "interviewer_absent"],
  completed: [],
  cancelled: [],
  rescheduled: [],
  no_show: [],
  interviewer_absent: [],
};

export const ATTEMPT_TRANSITIONS: Record<AttemptStatus, readonly AttemptStatus[]> = {
  awaiting_interview: ["awaiting_outcome"],
  awaiting_outcome: ["passed", "failed", "retake_later"],
  passed: [],
  failed: [],
  retake_later: [],
};

/**
 * Finalised outcomes are immutable for interviewers. The interview team may
 * issue a correction along these edges only; each correction appends a new
 * outcome row and an audit event. Withdrawing a pass is deliberately not a
 * "correction" - an earned badge is only removed through nullification.
 */
export const CORRECTION_TRANSITIONS: Record<AttemptStatus, readonly AttemptStatus[]> = {
  awaiting_interview: [],
  awaiting_outcome: [],
  passed: [],
  failed: ["passed", "retake_later"],
  retake_later: ["passed", "failed"],
};

export type BadgeState = "not_earned" | "earned" | "nullified";
export const BADGE_TRANSITIONS: Record<BadgeState, readonly BadgeState[]> = {
  not_earned: ["earned"],
  earned: ["nullified"],
  nullified: [],
};

export const canTransitionAppointment = (from: AppointmentStatus, to: AppointmentStatus) =>
  APPOINTMENT_TRANSITIONS[from].includes(to);
export const canTransitionAttempt = (from: AttemptStatus, to: AttemptStatus) =>
  ATTEMPT_TRANSITIONS[from].includes(to);
export const canCorrectAttempt = (from: AttemptStatus, to: AttemptStatus) =>
  CORRECTION_TRANSITIONS[from].includes(to);
export const canTransitionBadge = (from: BadgeState, to: BadgeState) => BADGE_TRANSITIONS[from].includes(to);

export function assertAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus) {
  if (!canTransitionAppointment(from, to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `An appointment that is ${humanize(from)} cannot become ${humanize(to)}.`,
    );
  }
}

export function assertAttemptTransition(from: AttemptStatus, to: AttemptStatus) {
  if (!canTransitionAttempt(from, to)) {
    throw new DomainError("INVALID_TRANSITION", `An attempt that is ${humanize(from)} cannot become ${humanize(to)}.`);
  }
}

export const OUTCOME_TO_STATUS: Record<Outcome, AttemptStatus> = {
  pass: "passed",
  fail: "failed",
  retake_later: "retake_later",
};
export const STATUS_TO_OUTCOME: Partial<Record<AttemptStatus, Outcome>> = {
  passed: "pass",
  failed: "fail",
  retake_later: "retake_later",
};

export const isOpenAttempt = (s: AttemptStatus) => s === "awaiting_interview" || s === "awaiting_outcome";
export const isFinalAttempt = (s: AttemptStatus) => !isOpenAttempt(s);

export const humanize = (s: string) => s.replace(/_/g, " ");

// ---------------------------------------------------------------- eligibility

export function computeEligibility(requiredSkillIds: readonly string[], clearedSkillIds: Iterable<string>) {
  const cleared = new Set(clearedSkillIds);
  const missing = requiredSkillIds.filter((id) => !cleared.has(id));
  return {
    eligible: requiredSkillIds.length > 0 && missing.length === 0,
    missing,
    clearedCount: requiredSkillIds.length - missing.length,
    requiredCount: requiredSkillIds.length,
  };
}

// ---------------------------------------------------------------- booking gate

export type BookingBlockCode =
  | "NOT_ELIGIBLE"
  | "BADGE_EARNED"
  | "BADGE_NULLIFIED"
  | "ALREADY_BOOKED"
  | "AWAITING_OUTCOME"
  | "FAILED_NEEDS_GRANT"
  | "RETAKE_NOT_YET";

export type BookingGateInput = {
  eligible: boolean;
  awardStatus: AwardStatus | null;
  openAttemptStatus: AttemptStatus | null;
  hasScheduledAppointment: boolean;
  lastFinalStatus: AttemptStatus | null;
  retakeAvailableAt: string | null;
  hasUnusedGrant: boolean;
  now: Date;
};

export type BookingGate = { allowed: true } | { allowed: false; code: BookingBlockCode; reason: string };

/**
 * Single source of truth for "may this student book an interview for this
 * badge right now?". Used by the UI to explain next steps and re-checked
 * inside the booking transaction.
 */
export function bookingGate(i: BookingGateInput): BookingGate {
  const block = (code: BookingBlockCode, reason: string): BookingGate => ({ allowed: false, code, reason });
  if (i.awardStatus === "nullified")
    return block("BADGE_NULLIFIED", "This badge was nullified. New interviews cannot be booked for it.");
  if (i.awardStatus === "active") return block("BADGE_EARNED", "You have already earned this badge.");
  if (!i.eligible) return block("NOT_ELIGIBLE", "Clear every required skill contest to unlock the interview.");
  if (i.hasScheduledAppointment)
    return block("ALREADY_BOOKED", "You already have an interview booked for this badge.");
  if (i.openAttemptStatus === "awaiting_outcome")
    return block("AWAITING_OUTCOME", "Your last interview is awaiting its result.");
  // An open attempt with no live appointment (cancelled / no-show / interviewer
  // unavailable) may simply be re-booked: no outcome was ever recorded.
  if (i.openAttemptStatus === "awaiting_interview") return { allowed: true };
  if (i.lastFinalStatus === "failed" && !i.hasUnusedGrant)
    return block("FAILED_NEEDS_GRANT", "A new attempt opens only when the GRIT interview team allows one.");
  if (i.lastFinalStatus === "retake_later" && i.retakeAvailableAt && i.now < new Date(i.retakeAvailableAt))
    return block("RETAKE_NOT_YET", "Your retake booking window has not opened yet.");
  return { allowed: true };
}

// ---------------------------------------------------------------- journey view

/** Presentation-only projection of the four stored lifecycles. Never stored. */
export type JourneyState =
  | "locked"
  | "eligible_unbooked"
  | "booked"
  | "awaiting_outcome"
  | "passed"
  | "failed"
  | "retake_later"
  | "nullified";

export const JOURNEY_STATES: readonly JourneyState[] = [
  "locked",
  "eligible_unbooked",
  "booked",
  "awaiting_outcome",
  "passed",
  "failed",
  "retake_later",
  "nullified",
];

export function deriveJourney(i: {
  eligible: boolean;
  awardStatus: AwardStatus | null;
  openAttemptStatus: AttemptStatus | null;
  scheduledStartsAt: string | null;
  lastFinalStatus: AttemptStatus | null;
  now: Date;
}): JourneyState {
  if (i.awardStatus === "nullified") return "nullified";
  if (i.awardStatus === "active") return "passed";
  if (!i.eligible) return "locked";
  if (i.openAttemptStatus === "awaiting_outcome") return "awaiting_outcome";
  if (i.scheduledStartsAt) return new Date(i.scheduledStartsAt) > i.now ? "booked" : "awaiting_outcome";
  if (i.lastFinalStatus === "failed") return "failed";
  if (i.lastFinalStatus === "retake_later") return "retake_later";
  return "eligible_unbooked";
}

// ---------------------------------------------------------------- change rules

export function studentChangeDeadline(startsAt: string) {
  return new Date(new Date(startsAt).getTime() - POLICY.changeCutoffMinutes * 60_000);
}

export function canStudentChange(startsAt: string, now: Date) {
  return now < studentChangeDeadline(startsAt);
}
