import type { Metadata } from "next";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { StudentHome } from "@/components/student/student-home";
import { getDb } from "@/db";
import { getNow } from "@/domain/core";
import { getStudentBadgeViews } from "@/domain/queries";
import { getPersona } from "@/lib/persona";

export const metadata: Metadata = { title: "Home" };

export default async function StudentHomePage() {
  const { student } = await getPersona();
  const db = getDb();
  const now = getNow(db);
  return (
    <>
      <AutoRefresh seconds={30} />
      <StudentHome student={student} views={getStudentBadgeViews(db, student.id, now)} now={now} />
    </>
  );
}
