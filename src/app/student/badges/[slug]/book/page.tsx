import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { Lock } from "lucide-react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Callout, LinkButton, PageHeader } from "@/components/app/ui";
import { SlotPicker, type PickerDay } from "@/components/student/slot-picker";
import { getDb } from "@/db";
import { trackBadges } from "@/db/schema";
import { listOpenSlots } from "@/domain/booking";
import { getNow } from "@/domain/core";
import { POLICY } from "@/domain/policy";
import { getStudentBadgeView } from "@/domain/queries";
import { getPersona } from "@/lib/persona";
import { dayKey, dayRange, fmtDateLong, fmtRange, fmtTime, shiftDay, TZ, zonedToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Book interview" };

const DAYS_AHEAD = 14;

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reschedule?: string }>;
}) {
  const { slug } = await params;
  const { reschedule } = await searchParams;
  const { student } = await getPersona();
  const db = getDb();
  const badge = db.select().from(trackBadges).where(eq(trackBadges.slug, slug)).get();
  if (!badge) notFound();
  const now = getNow(db);
  const view = getStudentBadgeView(db, student.id, badge.id, now)!;
  const back = { href: `/student/badges/${badge.slug}`, label: badge.name };

  const current = view.activeAppointment;
  const rescheduling = Boolean(reschedule && current && current.id === reschedule);
  let blocked: string | null = null;
  if (rescheduling) {
    if (!view.change?.allowed)
      blocked = `Interviews can be rescheduled up to ${POLICY.changeCutoffMinutes / 60} hours before they start. Please contact the GRIT interview team.`;
    else if (view.change.reschedulesLeft === 0)
      blocked = `This interview has already been rescheduled ${POLICY.maxReschedulesPerAttempt} times. Please contact the GRIT interview team.`;
  } else if (!view.gate.allowed) {
    blocked = view.gate.reason;
  }

  if (blocked) {
    return (
      <>
        <PageHeader back={back} title="Book interview" description={badge.name} />
        <Callout
          tone="neutral"
          icon={<Lock />}
          testId="booking-blocked"
          title="You cannot book this interview right now"
          actions={<LinkButton href={back.href}>Back to badge</LinkButton>}
        >
          {blocked}
        </Callout>
      </>
    );
  }

  const today = dayKey(now);
  const from = dayRange(today).start;
  const to = dayRange(shiftDay(today, DAYS_AHEAD)).start;
  const slots = listOpenSlots(db, { from, to, now });
  const days: PickerDay[] = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const key = shiftDay(today, i);
    const noon = zonedToUtc(key, "12:00");
    return {
      key,
      weekday: i === 0 ? "Today" : formatInTimeZone(noon, TZ, "EEE"),
      dayNum: formatInTimeZone(noon, TZ, "d"),
      month: formatInTimeZone(noon, TZ, "MMM"),
      longLabel: fmtDateLong(noon),
      slots: slots
        .filter((s) => dayKey(s.startsAt) === key)
        .map((s) => {
          const hour = Number(formatInTimeZone(new Date(s.startsAt), TZ, "H"));
          return {
            ...s,
            timeLabel: fmtTime(s.startsAt),
            endLabel: fmtTime(s.endsAt),
            period: hour < 12 ? ("Morning" as const) : hour < 17 ? ("Afternoon" as const) : ("Evening" as const),
          };
        }),
    };
  });

  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader
        back={back}
        title={rescheduling ? "Reschedule your interview" : "Book your interview"}
        description={
          rescheduling && current
            ? `${badge.name} · currently ${fmtDateLong(current.startsAt)}, ${fmtRange(current.startsAt, current.endsAt)} with ${current.interviewerName}. Your current slot is kept until you confirm a new one.`
            : `${badge.name} · a ${POLICY.slotMinutes}-minute live online interview. Slots come straight from interviewer availability and update while you browse.`
        }
      />
      <SlotPicker
        badgeId={badge.id}
        badgeName={badge.name}
        badgeSlug={badge.slug}
        days={days}
        rescheduleOf={rescheduling ? current!.id : undefined}
        currentSlotLabel={
          rescheduling && current ? `${fmtDateLong(current.startsAt)}, ${fmtRange(current.startsAt, current.endsAt)}` : undefined
        }
      />
    </>
  );
}
