import type { Metadata } from "next";
import { PageHeader } from "@/components/app/ui";
import { AvailabilityManager, type WindowRow } from "@/components/staff/availability-manager";
import { getDb } from "@/db";
import { listWindows } from "@/domain/availability";
import { scheduledBetween } from "@/domain/booking";
import { getNow } from "@/domain/core";
import { POLICY } from "@/domain/policy";
import { getPersona } from "@/lib/persona";
import { dayKey, dayRange, fmtDateLong, fmtHm, fmtRange, shiftDay } from "@/lib/time";

export const metadata: Metadata = { title: "Availability" };

const HORIZON_DAYS = 21;

export default async function AvailabilityPage() {
  const { interviewer } = await getPersona();
  const db = getDb();
  const now = getNow(db);
  const today = dayKey(now);
  const from = now.toISOString();
  const to = dayRange(shiftDay(today, HORIZON_DAYS)).start.toISOString();

  const rows: WindowRow[] = listWindows(db, interviewer.id, from, to).map((w) => ({
    id: w.id,
    day: dayKey(w.startsAt),
    dayLabel: fmtDateLong(w.startsAt),
    startHm: fmtHm(w.startsAt),
    endHm: fmtHm(w.endsAt),
    rangeLabel: fmtRange(w.startsAt, w.endsAt),
    slots: Math.round((Date.parse(w.endsAt) - Date.parse(w.startsAt)) / (POLICY.slotMinutes * 60_000)),
    booked: scheduledBetween(db, interviewer.id, w.startsAt, w.endsAt).length,
    inProgress: new Date(w.startsAt) <= now,
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/interviewer", label: "Schedule" }}
        title="Availability"
        description={`Offer time for interviews. Each window is cut into ${POLICY.slotMinutes}-minute slots that eligible students can book. Times are in IST.`}
      />
      <AvailabilityManager rows={rows} today={today} maxDay={shiftDay(today, 60)} slotMinutes={POLICY.slotMinutes} />
    </>
  );
}
