import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { EmptyState, LinkButton, PageHeader, Panel } from "@/components/app/ui";
import { getDb } from "@/db";
import { getNow } from "@/domain/core";
import { getOverview } from "@/domain/queries";
import { fmtDayShort, fmtRange, fmtStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

export default async function TeamOverviewPage() {
  const db = (await getDb());
  const now = (await getNow(db));
  const o = (await getOverview(db, now));
  const tiles: { label: string; value: number; hint: string; href: string; testId: string; warn?: boolean }[] = [
    { label: "Eligible students", value: o.eligible, hint: "Cleared every required skill", href: "/team/roster", testId: "stat-eligible" },
    { label: "Not booked", value: o.unbooked, hint: "Eligible, no interview booked", href: "/team/roster?state=eligible_unbooked", testId: "stat-unbooked", warn: o.unbooked > 0 },
    { label: "Booked", value: o.booked, hint: "Upcoming interviews", href: "/team/roster?state=booked", testId: "stat-booked" },
    { label: "Outcome pending", value: o.outcomePending, hint: "Interview time passed, no result", href: "/team/roster?state=awaiting_outcome", testId: "stat-pending", warn: o.outcomePending > 0 },
    { label: "Completed", value: o.completed, hint: "Interviews with a result", href: "/team/appointments?status=completed", testId: "stat-completed" },
  ];
  const total = Math.max(1, o.completed);
  const results = [
    { key: "pass", label: "Pass", value: o.outcomes.pass, bar: "bg-emerald-500" },
    { key: "fail", label: "Fail", value: o.outcomes.fail, bar: "bg-rose-500" },
    { key: "retake_later", label: "Retake later", value: o.outcomes.retake_later, bar: "bg-violet-500" },
  ];

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Interview operations"
        description="Who is eligible, who has booked, what is waiting on a result, and how interviews are turning out. Every number is computed live from the records."
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={cn(
              "rounded-xl border bg-card px-4 py-3.5 shadow-xs transition-colors hover:border-primary/50",
              t.warn && "border-amber-300",
            )}
          >
            <dt className="text-xs font-medium text-muted-foreground">{t.label}</dt>
            <dd className="mt-1 text-3xl font-semibold tracking-tight text-navy tabular-nums" data-testid={t.testId}>
              {t.value}
            </dd>
            <p className="mt-1 text-[0.7rem] leading-snug text-muted-foreground">{t.hint}</p>
          </Link>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Results breakdown" description={`${o.completed} interview${o.completed === 1 ? "" : "s"} with a recorded outcome`}>
          {o.completed === 0 ? (
            <p className="text-sm text-muted-foreground">No outcomes recorded yet.</p>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={results.map((r) => `${r.label} ${r.value}`).join(", ")}>
                {results.map((r) => (
                  <div key={r.key} className={r.bar} style={{ width: `${(r.value / total) * 100}%` }} />
                ))}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3">
                {results.map((r) => (
                  <div key={r.key}>
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-2 rounded-full", r.bar)} aria-hidden /> {r.label}
                    </dt>
                    <dd className="mt-0.5 text-xl font-semibold tabular-nums" data-testid={`result-${r.key}`}>
                      {r.value}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{Math.round((r.value / total) * 100)}%</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-4 text-sm sm:grid-cols-4">
            {[
              ["Badges active", o.badgesActive, "stat-badges-active"],
              ["Badges nullified", o.badgesNullified, "stat-badges-nullified"],
              ["Student no-shows", o.noShows, "stat-noshows"],
              ["Cancelled bookings", o.cancelled, "stat-cancelled"],
            ].map(([label, value, id]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums" data-testid={String(id)}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel
          title="Outcomes pending"
          description="Interviews whose time has passed without a recorded result."
          bodyClassName="p-0"
          className={o.pending.length ? "border-amber-300" : undefined}
        >
          {o.pending.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<CircleCheck />} title="Nothing waiting">
                Every interview that has taken place has a result.
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y" data-testid="team-pending">
              {o.pending.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {a.studentName} <span className="font-normal text-muted-foreground">· {a.badgeName}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {fmtStamp(a.startsAt)} · {a.interviewerName}
                    </p>
                  </div>
                  <LinkButton href={`/team/appointments/${a.id}`} variant="outline" size="sm">
                    Review
                  </LinkButton>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Eligible, not booked"
          description="Students who can book but have not."
          bodyClassName="p-0"
          action={
            <Link href="/team/roster?state=eligible_unbooked" className="rounded text-xs font-medium text-primary hover:underline">
              Open roster
            </Link>
          }
        >
          {o.unbookedRows.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<CircleCheck />} title="Everyone eligible has booked" />
            </div>
          ) : (
            <ul className="divide-y">
              {o.unbookedRows.map((r) => (
                <li key={r.eligibilityId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <Link href={`/team/students/${r.studentId}`} className="rounded font-medium hover:text-primary hover:underline">
                      {r.studentName}
                    </Link>
                    <p className="text-muted-foreground">{r.badgeName}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Eligible since {fmtStamp(r.eligibleAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Upcoming interviews"
          bodyClassName="p-0"
          action={
            <Link href="/team/appointments?status=scheduled" className="rounded text-xs font-medium text-primary hover:underline">
              All appointments
            </Link>
          }
        >
          {o.upcoming.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No interviews scheduled" />
            </div>
          ) : (
            <ul className="divide-y">
              {o.upcoming.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link href={`/team/appointments/${a.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-muted/50">
                    <div>
                      <p className="font-medium">
                        {a.studentName} <span className="font-normal text-muted-foreground">· {a.badgeName}</span>
                      </p>
                      <p className="text-muted-foreground">with {a.interviewerName}</p>
                    </div>
                    <p className="text-right text-xs text-muted-foreground tabular-nums">
                      {fmtDayShort(a.startsAt)}
                      <br />
                      {fmtRange(a.startsAt, a.endsAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
