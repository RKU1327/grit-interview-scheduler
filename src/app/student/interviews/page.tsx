import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, History } from "lucide-react";
import { OutcomePill, PhasePill } from "@/components/app/status";
import { EmptyState, LinkButton, PageHeader, Panel, tableCls } from "@/components/app/ui";
import { getDb } from "@/db";
import { getNow } from "@/domain/core";
import { POLICY } from "@/domain/policy";
import { appointmentPhase, getStudentBadgeViews } from "@/domain/queries";
import { getPersona } from "@/lib/persona";
import { fmtDate, fmtDateLong, fmtRange, fmtStamp } from "@/lib/time";

export const metadata: Metadata = { title: "My interviews" };

export default async function MyInterviewsPage() {
  const { student } = await getPersona();
  const db = getDb();
  const now = getNow(db);
  const views = getStudentBadgeViews(db, student.id, now);
  const active = views.filter((v) => v.activeAppointment);
  const history = views
    .flatMap((v) => v.attempts.flatMap((a) => a.appointments))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const bookable = views.filter((v) => v.gate.allowed);

  return (
    <>
      <PageHeader
        title="My interviews"
        description="Your current bookings and the full history of every booking, change and result."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="space-y-6">
          <Panel title="Current bookings">
            {active.length === 0 ? (
              <EmptyState icon={<CalendarDays />} title="You have no interview booked">
                {bookable.length > 0
                  ? "You are eligible to book. Pick a slot to get started."
                  : "Interviews unlock when you clear every skill a Track Badge requires."}
                {bookable.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {bookable.map((v) => (
                      <LinkButton key={v.badge.id} href={`/student/badges/${v.badge.slug}/book`} size="sm">
                        Book {v.badge.track}
                      </LinkButton>
                    ))}
                  </div>
                )}
              </EmptyState>
            ) : (
              <ul className="space-y-3">
                {active.map((v) => {
                  const a = v.activeAppointment!;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                      <div>
                        <p className="font-medium">{v.badge.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {fmtDateLong(a.startsAt)} · {fmtRange(a.startsAt, a.endsAt)} · with {a.interviewerName}
                        </p>
                        {v.change && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {v.change.allowed
                              ? `Reschedule or cancel until ${fmtStamp(v.change.deadline)}`
                              : "Change window closed - contact the GRIT interview team if you cannot attend"}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <PhasePill phase={appointmentPhase(a, now)} />
                        <LinkButton href={`/student/badges/${v.badge.slug}`} variant="outline" size="sm">
                          Manage
                        </LinkButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Booking history"
            description="Nothing is deleted: cancelled and rescheduled slots stay on record."
            bodyClassName="p-0"
          >
            {history.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<History />} title="No history yet">
                  Bookings, reschedules, cancellations and results will be listed here.
                </EmptyState>
              </div>
            ) : (
              <div className={tableCls.wrap}>
                <table className={tableCls.table}>
                  <thead>
                    <tr>
                      {["Interview", "Badge", "Attempt", "Interviewer", "Status", "Result"].map((h) => (
                        <th key={h} scope="col" className={tableCls.th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p) => (
                      <tr key={p.id}>
                        <td className={tableCls.td}>
                          <span className="font-medium">{fmtDate(p.startsAt)}</span>
                          <span className="block text-xs text-muted-foreground">{fmtRange(p.startsAt, p.endsAt)}</span>
                        </td>
                        <td className={tableCls.td}>
                          <Link href={`/student/badges/${p.badgeSlug}`} className="rounded text-primary hover:underline">
                            {p.badgeName}
                          </Link>
                        </td>
                        <td className={tableCls.td}>#{p.attemptNo}</td>
                        <td className={tableCls.td}>{p.interviewerName}</td>
                        <td className={tableCls.td}>
                          <PhasePill phase={appointmentPhase(p, now)} />
                          {p.closeReason && p.closedBy === "student" && (
                            <span className="mt-1 block text-xs text-muted-foreground">“{p.closeReason}”</span>
                          )}
                        </td>
                        <td className={tableCls.td}>
                          {p.outcome ? (
                            <Link href={`/student/results/${p.attemptId}`} className="rounded">
                              <OutcomePill outcome={p.outcome} />
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Booking rules" description="Prototype policy, shown wherever it applies.">
          <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
            <li>One live booking per Track Badge at a time.</li>
            <li>
              Slots are {POLICY.slotMinutes} minutes and must be booked at least {POLICY.bookingLeadMinutes} minutes ahead.
            </li>
            <li>
              Reschedule or cancel up to {POLICY.changeCutoffMinutes / 60} hours before the start; up to{" "}
              {POLICY.maxReschedulesPerAttempt} reschedules per attempt.
            </li>
            <li>A cancelled or missed slot has no result, so you can simply book again.</li>
            <li>After a “retake later” result you re-book yourself from the date shown.</li>
            <li>After a “fail” result a new attempt opens only when the interview team allows one.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
