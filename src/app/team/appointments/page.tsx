import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/app/ui";
import { AppointmentsTable, type AppointmentViewRow } from "@/components/staff/filter-tables";
import { getDb } from "@/db";
import { interviewers } from "@/db/schema";
import { getNow } from "@/domain/core";
import { appointmentPhase, listAppointments } from "@/domain/queries";
import { fmtDayShort, fmtRange } from "@/lib/time";

export const metadata: Metadata = { title: "Appointments" };

export default async function AppointmentsPage() {
  const db = getDb();
  const now = getNow(db);
  const rows: AppointmentViewRow[] = listAppointments(db, undefined, "desc").map((a) => ({
    id: a.id,
    whenLabel: fmtDayShort(a.startsAt),
    timeLabel: fmtRange(a.startsAt, a.endsAt).replace(" IST", ""),
    studentName: a.studentName,
    studentId: a.studentId,
    badgeName: a.badgeName,
    interviewerId: a.interviewerId,
    interviewerName: a.interviewerName,
    attemptNo: a.attemptNo,
    phase: appointmentPhase(a, now),
    outcome: a.outcome,
    isPast: new Date(a.endsAt) < now,
  }));
  return (
    <>
      <PageHeader
        title="Appointments"
        description="Every booking ever made, including cancelled and rescheduled ones, with its interviewer assignment and result."
      />
      <AppointmentsTable
        rows={rows}
        interviewers={db.select({ id: interviewers.id, name: interviewers.name }).from(interviewers).orderBy(asc(interviewers.name)).all()}
      />
    </>
  );
}
