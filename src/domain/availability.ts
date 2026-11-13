import { and, asc, eq, gt, lt, ne } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db";
import { appointments, availabilityWindows, interviewers, students, trackBadges } from "@/db/schema";
import { fmtDateTime, fmtRange, isDayKey, isHm, zonedToUtc } from "@/lib/time";
import { audit, inTx, newId, type Actor } from "./core";
import { scheduledBetween } from "./booking";
import { DomainError, POLICY } from "./policy";

const SLOT_MS = POLICY.slotMinutes * 60_000;

export type AvailabilityConflict = {
  appointmentId: string;
  studentName: string;
  badgeName: string;
  startsAt: string;
  endsAt: string;
};

function parseRange(day: string, startHm: string, endHm: string, now: Date) {
  if (!isDayKey(day) || !isHm(startHm) || !isHm(endHm))
    throw new DomainError("INVALID_RANGE", "Choose a valid date, start time and end time.");
  const start = zonedToUtc(day, startHm);
  const end = zonedToUtc(day, endHm);
  if (end <= start) throw new DomainError("INVALID_RANGE", "The end time must be after the start time.");
  if (start.getUTCMinutes() % POLICY.slotMinutes !== 0 || end.getUTCMinutes() % POLICY.slotMinutes !== 0)
    throw new DomainError("INVALID_RANGE", `Times must be on a ${POLICY.slotMinutes}-minute boundary.`);
  if (end.getTime() - start.getTime() < SLOT_MS)
    throw new DomainError("INVALID_RANGE", `A window must be at least ${POLICY.slotMinutes} minutes long.`);
  if (end <= now) throw new DomainError("IN_PAST", "Availability cannot be added or moved into the past.");
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function assertNoOverlap(tx: Tx, interviewerId: string, startIso: string, endIso: string, ignoreId = "") {
  const clash = (await tx
    .select()
    .from(availabilityWindows)
    .where(
      and(
        eq(availabilityWindows.interviewerId, interviewerId),
        lt(availabilityWindows.startsAt, endIso),
        gt(availabilityWindows.endsAt, startIso),
        ne(availabilityWindows.id, ignoreId),
      ),
    )
    .get());
  if (clash)
    throw new DomainError(
      "OVERLAP",
      `This overlaps your existing availability ${fmtRange(clash.startsAt, clash.endsAt)}. Edit that window instead.`,
    );
}

async function assertOwner(tx: Tx, windowId: string, actor: Actor) {
  const w = (await tx.select().from(availabilityWindows).where(eq(availabilityWindows.id, windowId)).get());
  if (!w) throw new DomainError("NOT_FOUND", "That availability window no longer exists.");
  if (actor.role !== "team" && actor.id !== w.interviewerId)
    throw new DomainError("FORBIDDEN", "You can only change your own availability.");
  return w;
}

/** Scheduled interviews that sat inside `old` and are not covered by `next` (or any other window). */
async function uncoveredBookings(
  tx: Tx,
  old: typeof availabilityWindows.$inferSelect,
  next: { startIso: string; endIso: string } | null,
): Promise<AvailabilityConflict[]> {
  const others = (await tx
    .select()
    .from(availabilityWindows)
    .where(and(eq(availabilityWindows.interviewerId, old.interviewerId), ne(availabilityWindows.id, old.id)))
    .all());
  const covers = (s: string, e: string, w: { startIso: string; endIso: string }) => w.startIso <= s && w.endIso >= e;
  const affected = (await scheduledBetween(tx, old.interviewerId, old.startsAt, old.endsAt))
    .filter((a) => {
      if (next && covers(a.startsAt, a.endsAt, next) && (Date.parse(a.startsAt) - Date.parse(next.startIso)) % SLOT_MS === 0)
        return false;
      return !others.some((o) => covers(a.startsAt, a.endsAt, { startIso: o.startsAt, endIso: o.endsAt }));
    });
  const conflicts: AvailabilityConflict[] = [];
  for (const a of affected) {
      const student = (await tx.select().from(students).where(eq(students.id, a.studentId)).get());
      const badge = (await tx.select().from(trackBadges).where(eq(trackBadges.id, a.badgeId)).get());
      conflicts.push({
        appointmentId: a.id,
        studentName: student?.name ?? "Student",
        badgeName: badge?.name ?? "Badge",
        startsAt: a.startsAt,
        endsAt: a.endsAt,
      });
  }
  return conflicts;
}

/** Explicit resolution: cancel the affected interviews on the interviewer's behalf. */
async function releaseBookings(tx: Tx, conflicts: AvailabilityConflict[], actor: Actor, now: Date) {
  for (const c of conflicts) {
    const appt = (await tx.select().from(appointments).where(eq(appointments.id, c.appointmentId)).get());
    if (!appt || appt.status !== "scheduled") continue;
    (await tx.update(appointments)
      .set({
        status: "cancelled",
        closedBy: actor.role,
        closeReason: "Interviewer is no longer available at this time",
        updatedAt: now.toISOString(),
      })
      .where(eq(appointments.id, appt.id))
      .run());
    (await audit(tx, {
      entityType: "appointment",
      entityId: appt.id,
      studentId: appt.studentId,
      badgeId: appt.badgeId,
      eventType: "appointment.cancelled",
      fromState: "scheduled",
      toState: "cancelled",
      actor,
      summary: `Interview on ${fmtDateTime(appt.startsAt)} released - interviewer no longer available`,
      detail: { reason: "availability_changed" },
      at: now,
    }));
  }
}

export async function createWindow(
  db: DbOrTx,
  input: { interviewerId: string; day: string; startHm: string; endHm: string; actor: Actor; now: Date },
): Promise<{ windowId: string }> {
  return (await inTx(db, async (tx) => {
    if (input.actor.role !== "team" && input.actor.id !== input.interviewerId)
      throw new DomainError("FORBIDDEN", "You can only change your own availability.");
    const interviewer = (await tx.select().from(interviewers).where(eq(interviewers.id, input.interviewerId)).get());
    if (!interviewer) throw new DomainError("NOT_FOUND", "Unknown interviewer.");
    const { startIso, endIso } = parseRange(input.day, input.startHm, input.endHm, input.now);
    (await assertNoOverlap(tx, interviewer.id, startIso, endIso));
    const id = newId("win");
    const nowIso = input.now.toISOString();
    (await tx.insert(availabilityWindows)
      .values({ id, interviewerId: interviewer.id, startsAt: startIso, endsAt: endIso, createdAt: nowIso, updatedAt: nowIso })
      .run());
    (await audit(tx, {
      entityType: "availability",
      entityId: id,
      eventType: "availability.created",
      actor: input.actor,
      summary: `${interviewer.name} added availability ${fmtDateTime(startIso)} to ${fmtRange(startIso, endIso)}`,
      detail: { startsAt: startIso, endsAt: endIso },
      at: input.now,
    }));
    return { windowId: id };
  }));
}

/**
 * Change or remove a window. If scheduled interviews would be left without
 * availability the change is refused with BOOKING_CONFLICT (listing them)
 * unless the caller explicitly chooses `resolution: "release"`.
 */
export async function updateWindow(
  db: DbOrTx,
  input: { windowId: string; day: string; startHm: string; endHm: string; resolution?: "release"; actor: Actor; now: Date },
): Promise<{ released: number }> {
  return (await inTx(db, async (tx) => {
    const old = (await assertOwner(tx, input.windowId, input.actor));
    const next = parseRange(input.day, input.startHm, input.endHm, input.now);
    (await assertNoOverlap(tx, old.interviewerId, next.startIso, next.endIso, old.id));
    const conflicts = (await uncoveredBookings(tx, old, next));
    if (conflicts.length && input.resolution !== "release")
      throw new DomainError(
        "BOOKING_CONFLICT",
        `${conflicts.length} booked interview${conflicts.length === 1 ? "" : "s"} would fall outside this window.`,
        { conflicts },
      );
    (await releaseBookings(tx, conflicts, input.actor, input.now));
    (await tx.update(availabilityWindows)
      .set({ startsAt: next.startIso, endsAt: next.endIso, updatedAt: input.now.toISOString() })
      .where(eq(availabilityWindows.id, old.id))
      .run());
    (await audit(tx, {
      entityType: "availability",
      entityId: old.id,
      eventType: "availability.updated",
      actor: input.actor,
      summary: `Availability changed to ${fmtDateTime(next.startIso)} to ${fmtRange(next.startIso, next.endIso)}`,
      detail: { from: [old.startsAt, old.endsAt], to: [next.startIso, next.endIso], released: conflicts.length },
      at: input.now,
    }));
    return { released: conflicts.length };
  }));
}

export async function deleteWindow(
  db: DbOrTx,
  input: { windowId: string; resolution?: "release"; actor: Actor; now: Date },
): Promise<{ released: number }> {
  return (await inTx(db, async (tx) => {
    const old = (await assertOwner(tx, input.windowId, input.actor));
    const conflicts = (await uncoveredBookings(tx, old, null));
    if (conflicts.length && input.resolution !== "release")
      throw new DomainError(
        "BOOKING_CONFLICT",
        `${conflicts.length} booked interview${conflicts.length === 1 ? "" : "s"} sit${conflicts.length === 1 ? "s" : ""} inside this window.`,
        { conflicts },
      );
    (await releaseBookings(tx, conflicts, input.actor, input.now));
    (await tx.delete(availabilityWindows).where(eq(availabilityWindows.id, old.id)).run());
    (await audit(tx, {
      entityType: "availability",
      entityId: old.id,
      eventType: "availability.removed",
      actor: input.actor,
      summary: `Availability removed: ${fmtDateTime(old.startsAt)} to ${fmtRange(old.startsAt, old.endsAt)}`,
      detail: { startsAt: old.startsAt, endsAt: old.endsAt, released: conflicts.length },
      at: input.now,
    }));
    return { released: conflicts.length };
  }));
}

export async function listWindows(db: DbOrTx, interviewerId: string, fromIso: string, toIso: string) {
  return (await db
    .select()
    .from(availabilityWindows)
    .where(
      and(
        eq(availabilityWindows.interviewerId, interviewerId),
        lt(availabilityWindows.startsAt, toIso),
        gt(availabilityWindows.endsAt, fromIso),
      ),
    )
    .orderBy(asc(availabilityWindows.startsAt))
    .all());
}
