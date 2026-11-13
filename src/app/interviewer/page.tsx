import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gte, lt, or } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowRight, CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { OutcomePill, PhasePill } from "@/components/app/status";
import { EmptyState, LinkButton, PageHeader, Panel } from "@/components/app/ui";
import { getDb } from "@/db";
import { appointments, interviewAttempts } from "@/db/schema";
import { listWindows } from "@/domain/availability";
import { listOpenSlots } from "@/domain/booking";
import { getNow } from "@/domain/core";
import { appointmentPhase, getDaySchedule, listAppointments } from "@/domain/queries";
import { getPersona } from "@/lib/persona";
import { dayKey, dayRange, fmtDateLong, fmtDayShort, fmtRange, isDayKey, shiftDay, TZ, zonedToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const { interviewer } = await getPersona();
  const db = (await getDb());
  const now = (await getNow(db));
  const today = dayKey(now);
  const day = isDayKey(date) ? date : today;
  const { start, end } = dayRange(day);

  const schedule = (await getDaySchedule(db, interviewer.id, day));
  const windows = (await listWindows(db, interviewer.id, start.toISOString(), end.toISOString()));
  const freeSlots = (await listOpenSlots(db, { from: start, to: end, now })).filter((s) => s.interviewerId === interviewer.id).length;

  // Anything of mine that happened but has no result yet, whatever the date.
  const pending = (await listAppointments(
    db,
    and(
      eq(appointments.interviewerId, interviewer.id),
      or(
        and(eq(appointments.status, "scheduled"), lt(appointments.startsAt, now.toISOString())),
        and(eq(appointments.status, "completed"), eq(interviewAttempts.status, "awaiting_outcome")),
      ),
    ),
  ));

  // Week strip: the selected day in the middle of a 7-day window, with live interview counts.
  const stripStart = shiftDay(day, -3);
  const stripRange = { from: dayRange(stripStart).start, to: dayRange(shiftDay(stripStart, 7)).start };
  const stripAppts = (await listAppointments(
    db,
    and(
      eq(appointments.interviewerId, interviewer.id),
      gte(appointments.startsAt, stripRange.from.toISOString()),
      lt(appointments.startsAt, stripRange.to.toISOString()),
    ),
  )).filter((a) => a.status === "scheduled" || a.status === "completed");
  const strip = Array.from({ length: 7 }, (_, i) => {
    const key = shiftDay(stripStart, i);
    const noon = zonedToUtc(key, "12:00");
    return {
      key,
      weekday: formatInTimeZone(noon, TZ, "EEE"),
      dayNum: formatInTimeZone(noon, TZ, "d"),
      count: stripAppts.filter((a) => dayKey(a.startsAt) === key).length,
    };
  });
  const next = (await listAppointments(
    db,
    and(eq(appointments.interviewerId, interviewer.id), eq(appointments.status, "scheduled"), gte(appointments.startsAt, now.toISOString())),
  ))[0];

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Daily schedule"
        description={`${interviewer.name} · interviews booked into your availability. New bookings appear here automatically.`}
        actions={
          <LinkButton href="/interviewer/availability" variant="outline">
            Manage availability
          </LinkButton>
        }
      />

      {pending.length > 0 && (
        <Panel
          className="mb-6 border-amber-300"
          title={`${pending.length} interview${pending.length === 1 ? "" : "s"} waiting for an outcome`}
          description="The student sees “result pending” until you record pass, fail or retake later."
          bodyClassName="p-0"
          data-testid="pending-outcomes"
        >
          <ul className="divide-y">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="text-sm">
                  <p className="font-medium">
                    {a.studentName} <span className="font-normal text-muted-foreground">· {a.badgeName}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {fmtDayShort(a.startsAt)} · {fmtRange(a.startsAt, a.endsAt)}
                  </p>
                </div>
                <LinkButton href={`/interviewer/interviews/${a.id}`} size="sm" data-testid={`record-${a.studentId}`}>
                  Record outcome
                </LinkButton>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <LinkButton href={`/interviewer?date=${shiftDay(day, -1)}`} variant="outline" size="sm" aria-label="Previous day">
            <ChevronLeft aria-hidden />
          </LinkButton>
          <LinkButton href="/interviewer" variant="outline" size="sm" aria-current={day === today ? "date" : undefined}>
            Today
          </LinkButton>
          <LinkButton href={`/interviewer?date=${shiftDay(day, 1)}`} variant="outline" size="sm" aria-label="Next day">
            <ChevronRight aria-hidden />
          </LinkButton>
          <h2 className="ml-2 text-base font-semibold tracking-tight" data-testid="schedule-date">
            {fmtDateLong(zonedToUtc(day, "12:00"))}
            {day === today && <span className="ml-2 text-sm font-normal text-muted-foreground">Today</span>}
          </h2>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Jump to day">
          {strip.map((d) => (
            <Link
              key={d.key}
              href={`/interviewer?date=${d.key}`}
              aria-current={d.key === day ? "date" : undefined}
              aria-label={`${d.weekday} ${d.dayNum}, ${d.count} interviews`}
              className={cn(
                "flex w-11 flex-col items-center rounded-lg border py-1 text-xs transition-colors",
                d.key === day ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50",
              )}
            >
              <span className="text-[0.65rem] uppercase">{d.weekday}</span>
              <span className="font-semibold tabular-nums">{d.dayNum}</span>
              <span
                className={cn(
                  "mt-0.5 h-1 w-4 rounded-full",
                  d.count > 0 ? (d.key === day ? "bg-white" : "bg-primary") : "bg-transparent",
                )}
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <Panel title="Interviews" description="All times in IST." bodyClassName="p-0">
          {schedule.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<CalendarOff />} title="No interviews on this day">
                {windows.length === 0
                  ? "You have not offered any availability for this day."
                  : `You have ${freeSlots} open slot${freeSlots === 1 ? "" : "s"} students can still book.`}
                {next && (
                  <p className="mt-2">
                    <Link href={`/interviewer?date=${dayKey(next.startsAt)}`} className="font-medium text-primary hover:underline">
                      Next interview: {fmtDayShort(next.startsAt)}, {fmtRange(next.startsAt, next.endsAt)} →
                    </Link>
                  </p>
                )}
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y" data-testid="schedule-list">
              {schedule.map((a) => {
                const phase = appointmentPhase(a, now);
                const closed = ["cancelled", "rescheduled", "no_show", "interviewer_absent"].includes(a.status);
                return (
                  <li key={a.id} data-testid="schedule-row" data-student={a.studentId}>
                    <Link
                      href={`/interviewer/interviews/${a.id}`}
                      className={cn(
                        "flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50",
                        closed && "opacity-60",
                      )}
                    >
                      <div className="w-36 text-sm font-semibold tabular-nums">{fmtRange(a.startsAt, a.endsAt).replace(" IST", "")}</div>
                      <div className="min-w-0 flex-1 text-sm">
                        <p className={cn("font-medium", closed && "line-through")}>{a.studentName}</p>
                        <p className="truncate text-muted-foreground">
                          {a.badgeName} · attempt {a.attemptNo}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {a.outcome && <OutcomePill outcome={a.outcome} />}
                        <PhasePill phase={phase} />
                        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Availability this day"
          action={
            <Link href="/interviewer/availability" className="rounded text-xs font-medium text-primary hover:underline">
              Edit
            </Link>
          }
        >
          {windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No availability offered.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {windows.map((w) => (
                <li key={w.id} className="rounded-lg bg-accent/60 px-3 py-2 font-medium tabular-nums">
                  {fmtRange(w.startsAt, w.endsAt)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {freeSlots} open slot{freeSlots === 1 ? "" : "s"} still bookable on this day.
          </p>
        </Panel>
      </div>
    </>
  );
}
