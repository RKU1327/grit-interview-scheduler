import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  badgeEligibilities,
  badgeSkillRequirements,
  skills,
  students,
  studentSkillCompletions,
  trackBadges,
} from "@/db/schema";
import { audit, inTx, newId, SYSTEM_ACTOR, type Actor } from "./core";
import { computeEligibility, DomainError } from "./policy";

/**
 * Record that a student cleared a skill contest, then re-evaluate every badge
 * that requires that skill. Idempotent: replaying the same completion (e.g. a
 * duplicated contest webhook) changes nothing and grants nothing twice.
 */
export function clearSkill(
  db: DbOrTx,
  input: { studentId: string; skillId: string; actor?: Actor; now: Date },
): { alreadyCleared: boolean; newlyEligibleBadgeIds: string[] } {
  const actor = input.actor ?? SYSTEM_ACTOR;
  return inTx(db, (tx) => {
    const student = tx.select().from(students).where(eq(students.id, input.studentId)).get();
    const skill = tx.select().from(skills).where(eq(skills.id, input.skillId)).get();
    if (!student || !skill) throw new DomainError("NOT_FOUND", "Unknown student or skill.");

    const inserted = tx
      .insert(studentSkillCompletions)
      .values({ studentId: student.id, skillId: skill.id, clearedAt: input.now.toISOString() })
      .onConflictDoNothing()
      .run();
    const alreadyCleared = inserted.changes === 0;
    if (!alreadyCleared) {
      audit(tx, {
        entityType: "skill",
        entityId: skill.id,
        studentId: student.id,
        eventType: "skill.cleared",
        actor,
        summary: `${student.name} cleared the ${skill.name} skill contest`,
        at: input.now,
      });
    }

    const newlyEligibleBadgeIds: string[] = [];
    const cleared = tx
      .select({ skillId: studentSkillCompletions.skillId })
      .from(studentSkillCompletions)
      .where(eq(studentSkillCompletions.studentId, student.id))
      .all()
      .map((r) => r.skillId);
    const affected = tx
      .select({ badgeId: badgeSkillRequirements.badgeId })
      .from(badgeSkillRequirements)
      .where(eq(badgeSkillRequirements.skillId, skill.id))
      .all();

    for (const { badgeId } of affected) {
      const required = tx
        .select({ skillId: badgeSkillRequirements.skillId })
        .from(badgeSkillRequirements)
        .where(eq(badgeSkillRequirements.badgeId, badgeId))
        .all()
        .map((r) => r.skillId);
      if (!computeEligibility(required, cleared).eligible) continue;
      const exists = tx
        .select({ id: badgeEligibilities.id })
        .from(badgeEligibilities)
        .where(and(eq(badgeEligibilities.studentId, student.id), eq(badgeEligibilities.badgeId, badgeId)))
        .get();
      if (exists) continue;
      const id = newId("elg");
      tx.insert(badgeEligibilities)
        .values({ id, studentId: student.id, badgeId, eligibleAt: input.now.toISOString() })
        .run();
      const badge = tx.select().from(trackBadges).where(eq(trackBadges.id, badgeId)).get();
      audit(tx, {
        entityType: "eligibility",
        entityId: id,
        studentId: student.id,
        badgeId,
        eventType: "eligibility.granted",
        fromState: "locked",
        toState: "eligible",
        actor: SYSTEM_ACTOR,
        summary: `${student.name} became eligible for the ${badge?.name ?? "badge"} interview`,
        detail: { requiredSkills: required.length },
        at: input.now,
      });
      newlyEligibleBadgeIds.push(badgeId);
    }
    return { alreadyCleared, newlyEligibleBadgeIds };
  });
}
