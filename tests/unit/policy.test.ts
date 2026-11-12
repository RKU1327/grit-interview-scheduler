import { describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES, ATTEMPT_STATUSES } from "@/db/schema";
import {
  bookingGate,
  canCorrectAttempt,
  canStudentChange,
  canTransitionAppointment,
  canTransitionAttempt,
  canTransitionBadge,
  computeEligibility,
  deriveJourney,
  POLICY,
  type BookingGateInput,
} from "@/domain/policy";
import { dayKey, dayRange, fmtDateTime, shiftDay, zonedToUtc } from "@/lib/time";

const NOW = new Date("2026-11-02T03:30:00.000Z");

describe("eligibility calculation", () => {
  it("is eligible only when every required skill is cleared", () => {
    expect(computeEligibility(["a", "b", "c"], ["a", "b", "c"]).eligible).toBe(true);
    expect(computeEligibility(["a", "b", "c"], ["c", "b", "a", "zzz"]).eligible).toBe(true);
  });
  it("reports exactly which skills are missing", () => {
    const r = computeEligibility(["a", "b", "c"], ["a", "c"]);
    expect(r).toMatchObject({ eligible: false, missing: ["b"], clearedCount: 2, requiredCount: 3 });
  });
  it("never treats a badge with no requirements as eligible", () => {
    expect(computeEligibility([], ["a"]).eligible).toBe(false);
  });
});

describe("appointment lifecycle", () => {
  it("allows scheduled to reach every closing state", () => {
    for (const to of ["completed", "cancelled", "rescheduled", "no_show", "interviewer_absent"] as const)
      expect(canTransitionAppointment("scheduled", to)).toBe(true);
  });
  it("treats every other state as terminal", () => {
    for (const from of APPOINTMENT_STATUSES.filter((s) => s !== "scheduled"))
      for (const to of APPOINTMENT_STATUSES) expect(canTransitionAppointment(from, to)).toBe(false);
  });
});

describe("attempt / outcome lifecycle", () => {
  it("only moves forward: awaiting interview -> awaiting outcome -> final", () => {
    expect(canTransitionAttempt("awaiting_interview", "awaiting_outcome")).toBe(true);
    expect(canTransitionAttempt("awaiting_interview", "passed")).toBe(false);
    for (const to of ["passed", "failed", "retake_later"] as const)
      expect(canTransitionAttempt("awaiting_outcome", to)).toBe(true);
    expect(canTransitionAttempt("awaiting_outcome", "awaiting_interview")).toBe(false);
  });
  it("never lets a final outcome change through the normal path", () => {
    for (const from of ["passed", "failed", "retake_later"] as const)
      for (const to of ATTEMPT_STATUSES) expect(canTransitionAttempt(from, to)).toBe(false);
  });
  it("limits corrections: fail <-> retake, either -> pass, never away from pass", () => {
    expect(canCorrectAttempt("failed", "passed")).toBe(true);
    expect(canCorrectAttempt("failed", "retake_later")).toBe(true);
    expect(canCorrectAttempt("retake_later", "failed")).toBe(true);
    expect(canCorrectAttempt("passed", "failed")).toBe(false);
    expect(canCorrectAttempt("passed", "retake_later")).toBe(false);
    expect(canCorrectAttempt("awaiting_outcome", "passed")).toBe(false);
  });
});

describe("badge lifecycle", () => {
  it("is not earned -> earned -> nullified with no way back", () => {
    expect(canTransitionBadge("not_earned", "earned")).toBe(true);
    expect(canTransitionBadge("earned", "nullified")).toBe(true);
    expect(canTransitionBadge("not_earned", "nullified")).toBe(false);
    expect(canTransitionBadge("nullified", "earned")).toBe(false);
    expect(canTransitionBadge("earned", "not_earned")).toBe(false);
  });
});

describe("booking gate", () => {
  const base: BookingGateInput = {
    eligible: true,
    awardStatus: null,
    openAttemptStatus: null,
    hasScheduledAppointment: false,
    lastFinalStatus: null,
    retakeAvailableAt: null,
    hasUnusedGrant: false,
    now: NOW,
  };
  const code = (i: Partial<BookingGateInput>) => {
    const g = bookingGate({ ...base, ...i });
    return g.allowed ? "OK" : g.code;
  };
  it("allows a first booking once eligible", () => expect(code({})).toBe("OK"));
  it("blocks a student who is missing a skill", () => expect(code({ eligible: false })).toBe("NOT_ELIGIBLE"));
  it("blocks a second live booking", () =>
    expect(code({ openAttemptStatus: "awaiting_interview", hasScheduledAppointment: true })).toBe("ALREADY_BOOKED"));
  it("blocks while an outcome is pending", () =>
    expect(code({ openAttemptStatus: "awaiting_outcome" })).toBe("AWAITING_OUTCOME"));
  it("allows re-booking an open attempt whose appointment was cancelled", () =>
    expect(code({ openAttemptStatus: "awaiting_interview" })).toBe("OK"));
  it("blocks after a fail until the team opens a new attempt", () => {
    expect(code({ lastFinalStatus: "failed" })).toBe("FAILED_NEEDS_GRANT");
    expect(code({ lastFinalStatus: "failed", hasUnusedGrant: true })).toBe("OK");
  });
  it("treats retake later differently from fail: self-serve once the window opens", () => {
    const later = new Date(NOW.getTime() + 86_400_000).toISOString();
    const earlier = new Date(NOW.getTime() - 1000).toISOString();
    expect(code({ lastFinalStatus: "retake_later", retakeAvailableAt: later })).toBe("RETAKE_NOT_YET");
    expect(code({ lastFinalStatus: "retake_later", retakeAvailableAt: earlier })).toBe("OK");
  });
  it("blocks for earned and nullified badges", () => {
    expect(code({ awardStatus: "active", lastFinalStatus: "passed" })).toBe("BADGE_EARNED");
    expect(code({ awardStatus: "nullified", lastFinalStatus: "passed" })).toBe("BADGE_NULLIFIED");
  });
});

describe("journey projection", () => {
  const base = {
    eligible: true,
    awardStatus: null,
    openAttemptStatus: null,
    scheduledStartsAt: null,
    lastFinalStatus: null,
    now: NOW,
  } as const;
  it("maps each combination of stored lifecycles to one display state", () => {
    expect(deriveJourney({ ...base, eligible: false })).toBe("locked");
    expect(deriveJourney(base)).toBe("eligible_unbooked");
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    const past = new Date(NOW.getTime() - 3_600_000).toISOString();
    expect(deriveJourney({ ...base, openAttemptStatus: "awaiting_interview", scheduledStartsAt: future })).toBe("booked");
    expect(deriveJourney({ ...base, openAttemptStatus: "awaiting_interview", scheduledStartsAt: past })).toBe("awaiting_outcome");
    expect(deriveJourney({ ...base, openAttemptStatus: "awaiting_outcome" })).toBe("awaiting_outcome");
    expect(deriveJourney({ ...base, lastFinalStatus: "failed" })).toBe("failed");
    expect(deriveJourney({ ...base, lastFinalStatus: "retake_later" })).toBe("retake_later");
    expect(deriveJourney({ ...base, awardStatus: "active", lastFinalStatus: "passed" })).toBe("passed");
    expect(deriveJourney({ ...base, awardStatus: "nullified", lastFinalStatus: "passed" })).toBe("nullified");
  });
  it("shows a new booking even when an earlier attempt failed", () => {
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(
      deriveJourney({ ...base, lastFinalStatus: "failed", openAttemptStatus: "awaiting_interview", scheduledStartsAt: future }),
    ).toBe("booked");
  });
});

describe("student change window", () => {
  it("closes exactly at the cutoff before the start", () => {
    const start = new Date(NOW.getTime() + POLICY.changeCutoffMinutes * 60_000).toISOString();
    expect(canStudentChange(start, new Date(NOW.getTime() - 1))).toBe(true);
    expect(canStudentChange(start, NOW)).toBe(false);
  });
});

describe("time zone handling (Asia/Kolkata)", () => {
  it("assigns late-evening UTC instants to the next IST calendar day", () => {
    expect(dayKey("2026-11-01T18:29:59.000Z")).toBe("2026-11-01");
    expect(dayKey("2026-11-01T18:30:00.000Z")).toBe("2026-11-02");
  });
  it("builds a half-open IST day range in UTC", () => {
    const { start, end } = dayRange("2026-11-02");
    expect(start.toISOString()).toBe("2026-11-01T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T18:30:00.000Z");
  });
  it("converts IST wall time to UTC and crosses month boundaries", () => {
    expect(zonedToUtc("2026-11-02", "10:00").toISOString()).toBe("2026-11-02T04:30:00.000Z");
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
  });
  it("always labels formatted times with IST", () => {
    expect(fmtDateTime("2026-11-02T04:30:00.000Z")).toBe("Mon, 2 Nov 2026 · 10:00 AM IST");
  });
});
