import { openDatabase, type Db } from "@/db";
import * as s from "@/db/schema";
import type { Actor } from "@/domain/core";
import { clearSkill } from "@/domain/eligibility";
import { DomainError } from "@/domain/policy";
import { expect } from "vitest";

/** Fixed "now" for deterministic tests: Mon 2 Nov 2026, 09:00 IST. */
export const NOW = new Date("2026-11-02T03:30:00.000Z");
export const mins = (n: number, from: Date = NOW) => new Date(from.getTime() + n * 60_000);
export const hours = (n: number, from: Date = NOW) => mins(n * 60, from);

export const TEAM: Actor = { role: "team", id: "team_ops", name: "Team" };
export const asStudent = (id: string): Actor => ({ role: "student", id, name: id });
export const asInterviewer = (id: string): Actor => ({ role: "interviewer", id, name: id });

/**
 * A small in-memory world: 2 students, 1 badge needing skills A+B,
 * 2 interviewers. `i1` is available 10:00-12:00 IST today and tomorrow,
 * `i2` 10:00-11:00 IST today.
 */
export function makeWorld(): Db {
  const db = openDatabase(":memory:");
  const created = NOW.toISOString();
  db.insert(s.skills)
    .values([
      { id: "A", code: "a", name: "Skill A" },
      { id: "B", code: "b", name: "Skill B" },
      { id: "C", code: "c", name: "Skill C" },
    ])
    .run();
  db.insert(s.trackBadges)
    .values([
      { id: "badge", slug: "badge", track: "T", tier: "Novice", name: "Test Badge", description: "d" },
      { id: "badge2", slug: "badge2", track: "T2", tier: "Novice", name: "Other Badge", description: "d" },
    ])
    .run();
  db.insert(s.badgeSkillRequirements)
    .values([
      { badgeId: "badge", skillId: "A" },
      { badgeId: "badge", skillId: "B" },
      { badgeId: "badge2", skillId: "C" },
    ])
    .run();
  db.insert(s.students)
    .values(
      ["s1", "s2", "s3"].map((id) => ({ id, name: `Student ${id}`, email: `${id}@t.example`, cohort: "c", createdAt: created })),
    )
    .run();
  db.insert(s.interviewers)
    .values(["i1", "i2"].map((id) => ({ id, name: `Interviewer ${id}`, email: `${id}@t.example` })))
    .run();
  const win = (id: string, interviewerId: string, startsAt: string, endsAt: string) =>
    db.insert(s.availabilityWindows).values({ id, interviewerId, startsAt, endsAt, createdAt: created, updatedAt: created }).run();
  win("w1", "i1", SLOT(0), SLOT(4)); // 10:00-12:00 IST today
  win("w2", "i1", SLOT(48), SLOT(52)); // same, tomorrow
  win("w3", "i2", SLOT(0), SLOT(2)); // 10:00-11:00 IST today
  return db;
}

/** ISO start of the n-th 30-minute slot counted from 10:00 IST on the test day. */
export const SLOT = (n: number) => new Date(Date.parse("2026-11-02T04:30:00.000Z") + n * 30 * 60_000).toISOString();

export function makeEligible(db: Db, studentId: string, at: Date = NOW, badge: "badge" | "badge2" = "badge") {
  for (const skillId of badge === "badge" ? ["A", "B"] : ["C"]) clearSkill(db, { studentId, skillId, now: at });
}

export function expectDomainError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return e as DomainError;
  }
  throw new Error(`Expected DomainError ${code} but nothing was thrown`);
}
