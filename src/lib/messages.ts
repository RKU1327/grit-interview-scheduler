import type { Outcome } from "@/db/schema";

/**
 * The three key student-facing messages. The wording here is the single
 * source of truth: the app renders these templates and docs/Student_Messages.md
 * quotes them verbatim (a test fails if the two drift apart).
 * Placeholders in {braces} are filled at render time.
 */
export const KEY_MESSAGES = {
  /** 1. Shown the moment the last required skill is cleared. */
  eligibility: {
    title: "You're eligible for the {badgeName} interview",
    body: "You've cleared all {skillCount} required skills. The last step to earn this Track Badge is a live online interview with a GRIT interviewer. Choose a 30-minute slot that suits you. All times are shown in India Standard Time (IST).",
    cta: "Book your interview",
  },
  /** 2. Shown after a slot is booked (and after a reschedule). */
  bookingConfirmed: {
    title: "Your interview is booked for {date} at {startTime} IST",
    body: "{badgeName} interview with {interviewerName} on {weekdayDate}, {startTime} – {endTime} IST (Asia/Kolkata). Please be online and ready a few minutes before the start. You can reschedule or cancel until {changeDeadline}. After the interview, your result will appear here as soon as your interviewer records it.",
    cta: "Manage booking",
  },
  /** 3. Shown when the interviewer records the outcome. One variant per outcome. */
  result: {
    pass: {
      title: "You passed. The {badgeName} badge is yours.",
      body: "Congratulations, {firstName}. Your interviewer recorded a pass for your interview on {interviewDate}, and the badge has been added to your profile. Next step: open your badge to see it, then keep clearing skill contests towards your next Track Badge.",
      cta: "View your badge",
    },
    fail: {
      title: "Result for your {badgeName} interview: not passed",
      body: "Your interviewer recorded a fail for your interview on {interviewDate}, so this badge has not been awarded. The skills you have cleared stay cleared. Next step: revisit the required skills for this badge. A new interview attempt opens only when the GRIT interview team allows one, and you will see it here if that happens.",
      cta: "Review required skills",
    },
    retake_later: {
      title: "Result for your {badgeName} interview: retake needed",
      body: "Your interviewer has asked you to take this interview again. This is not a fail, and the badge has not been awarded yet. Next step: book a new slot. Booking opens for you on {retakeDate}.",
      cta: "Book your retake",
    },
  } satisfies Record<Outcome, { title: string; body: string; cta: string }>,
} as const;

/** Supporting status copy (not one of the three key messages). */
export const NULLIFIED_MESSAGE = {
  title: "Your {badgeName} badge has been nullified",
  body: "The badge you earned on {awardedDate} was nullified on {nullifiedDate} after the GRIT interview team confirmed malpractice. It no longer counts as earned. Your interview history stays on record. If you believe this is a mistake, contact the GRIT interview team.",
};

export function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** Every template string, for the docs-drift test. */
export function allKeyMessageStrings(): string[] {
  const m = KEY_MESSAGES;
  return [
    m.eligibility.title,
    m.eligibility.body,
    m.bookingConfirmed.title,
    m.bookingConfirmed.body,
    ...Object.values(m.result).flatMap((r) => [r.title, r.body]),
  ];
}
