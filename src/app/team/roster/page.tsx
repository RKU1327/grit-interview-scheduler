import type { Metadata } from "next";
import { PageHeader } from "@/components/app/ui";
import { RosterTable, type RosterViewRow } from "@/components/staff/filter-tables";
import { getDb } from "@/db";
import { getNow } from "@/domain/core";
import { getRoster } from "@/domain/queries";
import { fmtDate, fmtDayShort, fmtStamp, fmtTime } from "@/lib/time";

export const metadata: Metadata = { title: "Eligible students" };

export default async function RosterPage() {
  const db = getDb();
  const now = getNow(db);
  const roster = getRoster(db, now);
  const rows: RosterViewRow[] = roster.map((r) => ({
    key: r.eligibilityId,
    studentId: r.studentId,
    studentName: r.studentName,
    studentEmail: r.studentEmail,
    badgeName: r.badgeName,
    eligibleLabel: fmtStamp(r.eligibleAt),
    journey: r.journey,
    bookingLabel: r.scheduled
      ? `${fmtDayShort(r.scheduled.startsAt)}, ${fmtTime(r.scheduled.startsAt)} · ${r.scheduled.interviewerName}`
      : r.journey === "retake_later" && r.retakeAvailableAt
        ? `Re-book from ${fmtDate(r.retakeAvailableAt)}`
        : "No live booking",
    bookingHref: r.scheduled ? `/team/appointments/${r.scheduled.id}` : null,
    attemptCount: r.attemptCount,
    nextAction: r.nextAction,
  }));

  return (
    <>
      <PageHeader
        title="Eligible students"
        description="Every student who has cleared all skills for a Track Badge, with whether they have booked and what should happen next. One row per student and badge."
      />
      <RosterTable rows={rows} badges={[...new Set(rows.map((r) => r.badgeName))].sort()} />
    </>
  );
}
