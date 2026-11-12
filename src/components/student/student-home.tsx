import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Circle } from "lucide-react";
import { JOURNEY_META, JourneyPill } from "@/components/app/status";
import { EmptyState, Panel } from "@/components/app/ui";
import type { JourneyState } from "@/domain/policy";
import type { StudentBadgeView } from "@/domain/queries";
import { fmtRange, relativeDayLabel, fmtDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { JourneyMessage } from "./messages";

const CARD_CTA: Record<JourneyState, string> = {
  locked: "View requirements",
  eligible_unbooked: "Book interview",
  booked: "Manage booking",
  awaiting_outcome: "View status",
  passed: "View badge",
  failed: "View result",
  retake_later: "View result",
  nullified: "View details",
};

const PRIORITY: JourneyState[] = [
  "awaiting_outcome",
  "booked",
  "eligible_unbooked",
  "retake_later",
  "failed",
  "nullified",
  "passed",
  "locked",
];

/**
 * Student home. A pure function of the student's badge views, so the real
 * dashboard and the before/after preview render exactly the same component.
 */
export function StudentHome({
  student,
  views,
  now,
}: {
  student: { name: string };
  views: StudentBadgeView[];
  now: Date;
}) {
  const firstName = student.name.split(" ")[0];
  const active = [...views]
    .filter((v) => v.journey !== "locked")
    .sort((a, b) => PRIORITY.indexOf(a.journey) - PRIORITY.indexOf(b.journey));
  const closest = views.find((v) => v.journey === "locked" && v.progress.clearedCount > 0);
  const upcoming = views.flatMap((v) => (v.activeAppointment ? [{ view: v, appt: v.activeAppointment }] : []));
  const skillsCleared = new Set(views.flatMap((v) => v.skills.filter((s) => s.clearedAt).map((s) => s.id))).size;
  const earned = views.filter((v) => v.journey === "passed").length;

  return (
    <div className="@container space-y-6" data-testid="student-home">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy">Welcome back, {firstName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clear every skill a Track Badge needs, then pass a live interview to earn it.
        </p>
      </div>

      <div className="space-y-3" data-testid="home-messages">
        {active.length > 0 ? (
          active.map((v) => <JourneyMessage key={v.badge.id} view={v} firstName={firstName} />)
        ) : closest ? (
          <JourneyMessage view={closest} firstName={firstName} />
        ) : (
          <EmptyState title="No interviews to book yet">
            Interviews unlock when you clear every skill contest a Track Badge requires. Your progress is below.
          </EmptyState>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Skills cleared", skillsCleared],
          ["Upcoming interviews", upcoming.length],
          ["Badges earned", earned],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3 shadow-xs">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-navy tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Panel title="Upcoming interviews" description="Times are shown in India Standard Time (IST).">
        {upcoming.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="Nothing scheduled">
            When you book an interview it will appear here with its date, time and interviewer.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {upcoming.map(({ view, appt }) => (
              <li key={appt.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex min-w-[4.5rem] flex-col items-center rounded-lg bg-accent px-2 py-1.5 text-center text-primary">
                    <span className="text-[0.65rem] font-semibold uppercase">{relativeDayLabel(appt.startsAt, now).slice(0, 9)}</span>
                    <span className="text-xs font-medium">{fmtDate(appt.startsAt).slice(0, -5)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{view.badge.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {fmtRange(appt.startsAt, appt.endsAt)} · with {appt.interviewerName}
                    </p>
                  </div>
                </div>
                <Link
                  href={`/student/badges/${view.badge.slug}`}
                  className="inline-flex items-center gap-1 rounded text-sm font-medium text-primary hover:underline"
                >
                  Manage <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <section aria-labelledby="badges-heading">
        <h2 id="badges-heading" className="mb-3 text-sm font-semibold tracking-tight">
          Your Track Badges
        </h2>
        <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {views.map((v) => (
            <BadgeCard key={v.badge.id} view={v} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function BadgeCard({ view }: { view: StudentBadgeView }) {
  const { badge, progress, journey } = view;
  const pct = Math.round((progress.clearedCount / Math.max(1, progress.requiredCount)) * 100);
  const tone = JOURNEY_META[journey].tone;
  const primary = journey === "eligible_unbooked";
  return (
    <article
      data-testid={`badge-card-${badge.slug}`}
      data-journey={journey}
      className={cn(
        "flex flex-col rounded-xl border bg-card shadow-xs",
        journey === "passed" && "border-emerald-300",
        journey === "nullified" && "border-rose-300",
      )}
    >
      <div className="flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">{badge.tier} badge</p>
            <h3 className={cn("mt-0.5 font-semibold tracking-tight text-navy", journey === "nullified" && "line-through decoration-rose-400")}>
              {badge.track}
            </h3>
          </div>
          <JourneyPill state={journey} />
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Required skills</span>
            <span className="font-medium tabular-nums">
              {progress.clearedCount} of {progress.requiredCount} cleared
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.requiredCount}
            aria-valuenow={progress.clearedCount}
            aria-label={`${badge.name} skills cleared`}
          >
            <div
              className={cn("h-full rounded-full", tone === "neutral" ? "bg-slate-400" : "bg-primary")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {view.skills.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset",
                  s.clearedAt ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-muted text-muted-foreground ring-border",
                )}
              >
                {s.clearedAt ? <Check className="size-3" aria-hidden /> : <Circle className="size-3" aria-hidden />}
                {s.name}
                <span className="sr-only">{s.clearedAt ? " cleared" : " not cleared yet"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t px-5 py-3">
        <Link
          href={primary ? `/student/badges/${badge.slug}/book` : `/student/badges/${badge.slug}`}
          className={cn(
            "inline-flex items-center gap-1 rounded text-sm font-medium hover:underline",
            primary ? "text-primary" : "text-foreground/80",
          )}
        >
          {CARD_CTA[journey]} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}
