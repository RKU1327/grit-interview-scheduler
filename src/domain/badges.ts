import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { attemptGrants, badgeAwards, badgeNullifications, students, trackBadges } from "@/db/schema";
import { audit, inTx, loadBadgeContext, newId, type Actor } from "./core";
import { canTransitionBadge, DomainError, POLICY } from "./policy";

/**
 * Nullify an earned badge after confirmed malpractice. This is not an
 * interview outcome: the passed attempt, its outcome row and the award row
 * all stay exactly as they were; the award is flipped to `nullified` and a
 * nullification record + audit event explain why and who confirmed it.
 */
export async function nullifyBadge(
  db: DbOrTx,
  input: { awardId: string; reason: string; actor: Actor; now: Date },
): Promise<{ nullificationId: string; replayed: boolean }> {
  return (await inTx(db, async (tx) => {
    if (input.actor.role !== "team")
      throw new DomainError("FORBIDDEN", "Only the interview team can nullify a badge.");
    const reason = input.reason.trim();
    if (reason.length < POLICY.minReasonLength)
      throw new DomainError(
        "REASON_REQUIRED",
        `Describe the confirmed malpractice in at least ${POLICY.minReasonLength} characters.`,
      );
    const award = (await tx.select().from(badgeAwards).where(eq(badgeAwards.id, input.awardId)).get());
    if (!award) throw new DomainError("NOT_FOUND", "That badge award does not exist.");
    const existing = (await tx.select().from(badgeNullifications).where(eq(badgeNullifications.awardId, award.id)).get());
    if (existing) return { nullificationId: existing.id, replayed: true };
    if (!canTransitionBadge(award.status === "active" ? "earned" : "nullified", "nullified"))
      throw new DomainError("INVALID_TRANSITION", "Only an earned badge can be nullified.");

    const student = (await tx.select().from(students).where(eq(students.id, award.studentId)).get());
    const badge = (await tx.select().from(trackBadges).where(eq(trackBadges.id, award.badgeId)).get());
    const id = newId("nul");
    (await tx.insert(badgeNullifications)
      .values({
        id,
        awardId: award.id,
        reason,
        confirmedById: input.actor.id,
        confirmedByName: input.actor.name,
        createdAt: input.now.toISOString(),
      })
      .run());
    (await tx.update(badgeAwards).set({ status: "nullified" }).where(eq(badgeAwards.id, award.id)).run());
    (await audit(tx, {
      entityType: "award",
      entityId: award.id,
      studentId: award.studentId,
      badgeId: award.badgeId,
      eventType: "badge.nullified",
      fromState: "earned",
      toState: "nullified",
      actor: input.actor,
      summary: `${badge?.name ?? "Badge"} nullified for ${student?.name ?? "student"} after confirmed malpractice`,
      detail: { reason, nullificationId: id },
      at: input.now,
    }));
    return { nullificationId: id, replayed: false };
  }));
}

/**
 * Prototype policy: after a FAIL the student cannot self-book. The interview
 * team opens one new attempt explicitly, with a reason, and that permission is
 * consumed by the next booking.
 */
export async function grantReattempt(
  db: DbOrTx,
  input: { studentId: string; badgeId: string; reason: string; actor: Actor; now: Date },
): Promise<{ grantId: string; replayed: boolean }> {
  return (await inTx(db, async (tx) => {
    if (input.actor.role !== "team")
      throw new DomainError("FORBIDDEN", "Only the interview team can open a new attempt.");
    const ctx = (await loadBadgeContext(tx, input.studentId, input.badgeId, input.now));
    if (ctx.unusedGrant) return { grantId: ctx.unusedGrant.id, replayed: true };
    if (ctx.award) throw new DomainError("INVALID_STATE", "This student already has a badge record for this track badge.");
    if (ctx.openAttempt || ctx.lastFinal?.status !== "failed")
      throw new DomainError("INVALID_STATE", "A new attempt can only be opened after a failed interview.");
    const reason = input.reason.trim();
    if (reason.length < POLICY.minReasonLength)
      throw new DomainError("REASON_REQUIRED", `Give a reason of at least ${POLICY.minReasonLength} characters.`);
    const id = newId("grt");
    (await tx.insert(attemptGrants)
      .values({
        id,
        studentId: input.studentId,
        badgeId: input.badgeId,
        reason,
        grantedById: input.actor.id,
        grantedByName: input.actor.name,
        createdAt: input.now.toISOString(),
      })
      .run());
    (await audit(tx, {
      entityType: "grant",
      entityId: id,
      studentId: input.studentId,
      badgeId: input.badgeId,
      eventType: "attempt.reopened",
      actor: input.actor,
      summary: "Interview team opened a new attempt after a failed interview",
      detail: { reason },
      at: input.now,
    }));
    return { grantId: id, replayed: false };
  }));
}
