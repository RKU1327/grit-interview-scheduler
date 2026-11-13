"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { appointments, interviewers, OUTCOMES, students, type Outcome } from "@/db/schema";
import { resetHostedDemo } from "@/db/turso-setup";
import { createWindow, deleteWindow, updateWindow } from "@/domain/availability";
import { grantReattempt, nullifyBadge } from "@/domain/badges";
import { bookAppointment, cancelAppointment, markAbsence, markConducted, rescheduleAppointment } from "@/domain/booking";
import { getNow, setClockOffsetMs, type Actor } from "@/domain/core";
import { clearSkill } from "@/domain/eligibility";
import { correctOutcome, recordOutcome } from "@/domain/outcomes";
import { DomainError } from "@/domain/policy";
import { getPersona, ROLE_HOME, ROLE_LABEL, ROLES, writePersona, type Role } from "@/lib/persona";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message: string }
  | { ok: false; code: string; message: string; details?: unknown };

type Ctx = { db: Db; now: Date; actor: Actor };

/**
 * Common wrapper for every mutation: resolves the acting persona, enforces
 * the roles allowed to perform the action, maps domain errors to a typed
 * result the UI can show, and revalidates all rendered data on success.
 */
async function run<T>(
  allowed: Role[],
  fn: (ctx: Ctx) => Promise<{ data: T; message: string }>,
): Promise<ActionResult<T>> {
  try {
    const persona = await getPersona();
    if (!allowed.includes(persona.role)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: `This action is for the ${allowed.map((r) => ROLE_LABEL[r]).join(" or ")} persona. You are acting as ${ROLE_LABEL[persona.role]}.`,
      };
    }
    const db = (await getDb());
    const out = await fn({ db, now: (await getNow(db)), actor: persona.actor });
    revalidatePath("/", "layout");
    return { ok: true, ...out };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, code: e.code, message: e.message, details: e.details };
    console.error("Demo operation failed; inspect the database state before retrying.");
    return { ok: false, code: "UNEXPECTED", message: "The change could not be confirmed. Refresh to check the current state before retrying." };
  }
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

// ---------------------------------------------------------------- demo / persona

export async function switchPersonaAction(role: string, personId?: string) {
  const persona = await getPersona();
  const nextRole: Role = ROLES.includes(role as Role) ? (role as Role) : persona.role;
  const db = (await getDb());
  let studentId = persona.student.id;
  let interviewerId = persona.interviewer.id;
  if (personId && nextRole === "student" && (await db.select().from(students).where(eq(students.id, personId)).get()))
    studentId = personId;
  if (personId && nextRole === "interviewer" && (await db.select().from(interviewers).where(eq(interviewers.id, personId)).get()))
    interviewerId = personId;
  await writePersona({ role: nextRole, studentId, interviewerId });
  revalidatePath("/", "layout");
  redirect(ROLE_HOME[nextRole]);
}

export async function resetDemoAction(): Promise<ActionResult> {
  return run(ROLES, async ({ db }) => {
    await resetHostedDemo(db.$client);
    return { data: undefined, message: "Demo data reset to its starting state." };
  });
}

/** Demo clock: jump to an instant (e.g. an interview's start) or back to real time. */
export async function setDemoClockAction(targetIso: string | null): Promise<ActionResult> {
  return run(ROLES, async ({ db }) => {
    if (targetIso === null) {
      (await setClockOffsetMs(db, 0));
      return { data: undefined, message: "Demo clock is back on real time." };
    }
    const target = Date.parse(targetIso);
    if (Number.isNaN(target)) throw new DomainError("INVALID_TIME", "That is not a valid time.");
    if (target < (await getNow(db)).getTime())
      throw new DomainError("INVALID_TIME", "The demo clock can only move forward. Use 'Back to real time' or reset the demo to go back.");
    (await setClockOffsetMs(db, target - Date.now()));
    return { data: undefined, message: "Demo clock moved forward." };
  });
}

/** Demo control standing in for the skill-contest system reporting a cleared contest. */
export async function clearSkillAction(skillId: string): Promise<ActionResult<{ newlyEligible: number }>> {
  return run(["student"], async ({ db, now, actor }) => {
    const r = (await clearSkill(db, { studentId: actor.id, skillId: str(skillId), now }));
    return {
      data: { newlyEligible: r.newlyEligibleBadgeIds.length },
      message: r.alreadyCleared
        ? "That skill was already cleared."
        : r.newlyEligibleBadgeIds.length
          ? "Skill cleared - you are now eligible for an interview."
          : "Skill cleared.",
    };
  });
}

// ---------------------------------------------------------------- student

export async function bookAction(input: {
  badgeId: string;
  interviewerId: string;
  startsAt: string;
  idempotencyKey: string;
  rescheduleOf?: string;
}): Promise<ActionResult<{ appointmentId: string }>> {
  return run(["student"], async ({ db, now, actor }) => {
    const common = {
      interviewerId: str(input.interviewerId),
      startsAt: str(input.startsAt),
      idempotencyKey: str(input.idempotencyKey, 80) || undefined,
      actor,
      now,
    };
    const r = input.rescheduleOf
      ? (await rescheduleAppointment(db, { appointmentId: str(input.rescheduleOf), ...common }))
      : (await bookAppointment(db, { studentId: actor.id, badgeId: str(input.badgeId), ...common }));
    return {
      data: { appointmentId: r.appointmentId },
      message: input.rescheduleOf ? "Interview rescheduled." : "Interview booked.",
    };
  });
}

export async function cancelAppointmentAction(appointmentId: string, reason?: string): Promise<ActionResult> {
  return run(ROLES, async ({ db, now, actor }) => {
    const r = (await cancelAppointment(db, { appointmentId: str(appointmentId), reason: str(reason), actor, now }));
    return { data: undefined, message: r.replayed ? "This interview was already cancelled." : "Interview cancelled. The slot has been released." };
  });
}

// ---------------------------------------------------------------- interviewer / team

export async function markConductedAction(appointmentId: string): Promise<ActionResult> {
  return run(["interviewer", "team"], async ({ db, now, actor }) => {
    (await markConducted(db, { appointmentId: str(appointmentId), actor, now }));
    return { data: undefined, message: "Marked as conducted. The outcome is now pending." };
  });
}

export async function markAbsenceAction(
  appointmentId: string,
  kind: "no_show" | "interviewer_absent",
  note?: string,
): Promise<ActionResult> {
  return run(["interviewer", "team"], async ({ db, now, actor }) => {
    if (kind !== "no_show" && kind !== "interviewer_absent") throw new DomainError("INVALID", "Unknown attendance type.");
    (await markAbsence(db, { appointmentId: str(appointmentId), kind, note: str(note), actor, now }));
    return {
      data: undefined,
      message: kind === "no_show" ? "Recorded as a student no-show. The student can book again." : "Recorded as interviewer absent. The student can book again.",
    };
  });
}

const asOutcome = (v: unknown): Outcome => {
  if (!OUTCOMES.includes(v as Outcome)) throw new DomainError("INVALID", "Choose pass, fail or retake later.");
  return v as Outcome;
};

export async function recordOutcomeAction(input: {
  appointmentId: string;
  outcome: string;
  privateNotes?: string;
  retakeWaitDays?: number;
}): Promise<ActionResult<{ replayed: boolean }>> {
  return run(["interviewer", "team"], async ({ db, now, actor }) => {
    const r = (await recordOutcome(db, {
      appointmentId: str(input.appointmentId),
      outcome: asOutcome(input.outcome),
      privateNotes: str(input.privateNotes, 2000),
      retakeWaitDays: Number.isFinite(input.retakeWaitDays) ? Number(input.retakeWaitDays) : undefined,
      actor,
      now,
    }));
    return {
      data: { replayed: r.replayed },
      message: r.replayed ? "This outcome was already recorded - nothing was duplicated." : "Outcome recorded and published to the student.",
    };
  });
}

export async function correctOutcomeAction(input: {
  attemptId: string;
  outcome: string;
  reason: string;
}): Promise<ActionResult> {
  return run(["team"], async ({ db, now, actor }) => {
    (await correctOutcome(db, { attemptId: str(input.attemptId), outcome: asOutcome(input.outcome), reason: str(input.reason, 1000), actor, now }));
    return { data: undefined, message: "Correction recorded. The original outcome is kept in the history." };
  });
}

export async function nullifyBadgeAction(awardId: string, reason: string): Promise<ActionResult> {
  return run(["team"], async ({ db, now, actor }) => {
    const r = (await nullifyBadge(db, { awardId: str(awardId), reason: str(reason, 1000), actor, now }));
    return { data: undefined, message: r.replayed ? "This badge was already nullified." : "Badge nullified. The student now sees the nullified status." };
  });
}

export async function grantReattemptAction(studentId: string, badgeId: string, reason: string): Promise<ActionResult> {
  return run(["team"], async ({ db, now, actor }) => {
    const r = (await grantReattempt(db, { studentId: str(studentId), badgeId: str(badgeId), reason: str(reason, 1000), actor, now }));
    return { data: undefined, message: r.replayed ? "A new attempt is already open for this student." : "New attempt opened. The student can now book." };
  });
}

// ---------------------------------------------------------------- availability

type WindowInput = { day: string; startHm: string; endHm: string };

export async function createWindowAction(input: WindowInput): Promise<ActionResult> {
  return run(["interviewer"], async ({ db, now, actor }) => {
    (await createWindow(db, { interviewerId: actor.id, day: str(input.day), startHm: str(input.startHm), endHm: str(input.endHm), actor, now }));
    return { data: undefined, message: "Availability added. Students can now book these slots." };
  });
}

export async function updateWindowAction(
  windowId: string,
  input: WindowInput,
  resolution?: "release",
): Promise<ActionResult<{ released: number }>> {
  return run(["interviewer"], async ({ db, now, actor }) => {
    const r = (await updateWindow(db, {
      windowId: str(windowId),
      day: str(input.day),
      startHm: str(input.startHm),
      endHm: str(input.endHm),
      resolution: resolution === "release" ? "release" : undefined,
      actor,
      now,
    }));
    return { data: r, message: r.released ? `Availability updated. ${r.released} interview(s) released for re-booking.` : "Availability updated." };
  });
}

export async function deleteWindowAction(windowId: string, resolution?: "release"): Promise<ActionResult<{ released: number }>> {
  return run(["interviewer"], async ({ db, now, actor }) => {
    const r = (await deleteWindow(db, { windowId: str(windowId), resolution: resolution === "release" ? "release" : undefined, actor, now }));
    return { data: r, message: r.released ? `Availability removed. ${r.released} interview(s) released for re-booking.` : "Availability removed." };
  });
}

/** Demo helper: jump the demo clock to the start of an appointment. */
export async function jumpToAppointmentAction(appointmentId: string): Promise<ActionResult> {
  const db = (await getDb());
  const appt = (await db.select().from(appointments).where(eq(appointments.id, str(appointmentId))).get());
  if (!appt) return { ok: false, code: "NOT_FOUND", message: "That appointment does not exist." };
  return setDemoClockAction(new Date(Date.parse(appt.startsAt) + 60_000).toISOString());
}
