import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { interviewers, students } from "@/db/schema";
import { DEFAULT_INTERVIEWER_ID, DEFAULT_STUDENT_ID, TEAM_ACTOR } from "@/db/seed-data";
import type { Actor } from "@/domain/core";

export type Role = "student" | "interviewer" | "team";
export const ROLES: Role[] = ["student", "interviewer", "team"];
export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  interviewer: "Interviewer",
  team: "Interview Team",
};
export const ROLE_HOME: Record<Role, string> = { student: "/student", interviewer: "/interviewer", team: "/team" };
export const PERSONA_COOKIE = "grit_persona";

type Stored = { role: Role; studentId: string; interviewerId: string };

/**
 * Demo persona (there is no real authentication in the prototype). The cookie
 * only selects who you are acting as; every server action still checks the
 * acting role and ownership before changing anything.
 */
export async function getPersona() {
  const jar = await cookies();
  let stored: Partial<Stored> = {};
  try {
    stored = JSON.parse(jar.get(PERSONA_COOKIE)?.value ?? "{}") as Partial<Stored>;
  } catch {
    stored = {};
  }
  const db = getDb();
  const student =
    (stored.studentId && db.select().from(students).where(eq(students.id, stored.studentId)).get()) ||
    db.select().from(students).where(eq(students.id, DEFAULT_STUDENT_ID)).get() ||
    db.select().from(students).get()!;
  const interviewer =
    (stored.interviewerId && db.select().from(interviewers).where(eq(interviewers.id, stored.interviewerId)).get()) ||
    db.select().from(interviewers).where(eq(interviewers.id, DEFAULT_INTERVIEWER_ID)).get() ||
    db.select().from(interviewers).get()!;
  const role: Role = ROLES.includes(stored.role as Role) ? (stored.role as Role) : "student";
  const actor: Actor =
    role === "student"
      ? { role, id: student.id, name: student.name }
      : role === "interviewer"
        ? { role, id: interviewer.id, name: interviewer.name }
        : TEAM_ACTOR;
  return { role, student, interviewer, actor };
}

export type Persona = Awaited<ReturnType<typeof getPersona>>;

export async function writePersona(next: Stored) {
  const jar = await cookies();
  jar.set(PERSONA_COOKIE, JSON.stringify(next), { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
}
