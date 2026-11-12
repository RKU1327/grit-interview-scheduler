import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { switchPersonaAction } from "@/app/actions";
import { JOURNEY_META } from "@/components/app/status";
import { EmptyState, PageHeader, Pill } from "@/components/app/ui";
import { BadgeDetail } from "@/components/student/badge-detail";
import { StudentHome } from "@/components/student/student-home";
import { getDb } from "@/db";
import { students } from "@/db/schema";
import { getNow } from "@/domain/core";
import type { JourneyState } from "@/domain/policy";
import { getStudentBadgeViews, type StudentBadgeView } from "@/domain/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Before / after" };

const AFTER_STATES: JourneyState[] = [
  "eligible_unbooked",
  "booked",
  "awaiting_outcome",
  "passed",
  "failed",
  "retake_later",
  "nullified",
];
const RANK: JourneyState[] = ["nullified", "passed", "awaiting_outcome", "booked", "retake_later", "failed", "eligible_unbooked", "locked"];

const bookings = (v: StudentBadgeView) => v.attempts.reduce((n, a) => n + a.appointments.length, 0);

type Example = { student: { id: string; name: string }; views: StudentBadgeView[]; focus: StudentBadgeView };

/**
 * Before / after comparison. Both panes render the real StudentHome and
 * BadgeDetail components against live records: for each journey state the
 * page finds a student who is currently in that state.
 */
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; screen?: string }>;
}) {
  const sp = await searchParams;
  const state = (AFTER_STATES.includes(sp.state as JourneyState) ? sp.state : "eligible_unbooked") as JourneyState;
  const screen = sp.screen === "badge" ? "badge" : "home";
  const db = getDb();
  const now = getNow(db);

  const examples = new Map<JourneyState, Example>();
  for (const student of db.select().from(students).orderBy(asc(students.id)).all()) {
    const views = getStudentBadgeViews(db, student.id, now);
    // A student represents the most advanced state among their badges.
    const focus = [...views].sort((a, b) => RANK.indexOf(a.journey) - RANK.indexOf(b.journey))[0];
    if (!focus) continue;
    const existing = examples.get(focus.journey);
    const better =
      !existing ||
      (focus.journey === "locked" && focus.progress.clearedCount > existing.focus.progress.clearedCount) ||
      // Prefer first-time examples (no earlier attempts) so each state reads cleanly.
      (focus.journey !== "locked" && bookings(focus) < bookings(existing.focus));
    if (better) examples.set(focus.journey, { student, views, focus });
  }
  const before = examples.get("locked");
  const after = examples.get(state);
  const href = (s: JourneyState, sc: string) => `/student/preview?state=${s}&screen=${sc}`;

  return (
    <>
      <PageHeader
        title="Before / after"
        description="How the student home and badge screens change as a student moves through the interview journey. Both sides are the live application components rendering real demo records, not screenshots."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="After state" className="flex flex-wrap gap-1.5">
          {AFTER_STATES.map((s) => (
            <Link
              key={s}
              href={href(s, screen)}
              scroll={false}
              aria-current={s === state ? "true" : undefined}
              data-testid={`preview-state-${s}`}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                s === state ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground/80 hover:border-primary/50",
                !examples.has(s) && "opacity-50",
              )}
            >
              {JOURNEY_META[s].short}
            </Link>
          ))}
        </div>
        <div role="group" aria-label="Screen" className="inline-flex rounded-lg border bg-card p-0.5">
          {(
            [
              ["home", "Home screen"],
              ["badge", "Badge & interview screen"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={href(state, value)}
              scroll={false}
              aria-current={screen === value ? "true" : undefined}
              data-testid={`preview-screen-${value}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                screen === value ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Pane label="Before" state="locked" example={before} screen={screen} now={now} />
        <Pane label="After" state={state} example={after} screen={screen} now={now} />
      </div>
    </>
  );
}

function Pane({
  label,
  state,
  example,
  screen,
  now,
}: {
  label: string;
  state: JourneyState;
  example: Example | undefined;
  screen: "home" | "badge";
  now: Date;
}) {
  const meta = JOURNEY_META[state];
  return (
    <section
      aria-label={`${label}: ${meta.short}`}
      data-testid={`preview-pane-${label.toLowerCase()}`}
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-navy px-1.5 py-0.5 text-[0.7rem] font-semibold tracking-wide text-white uppercase">{label}</span>
          <Pill tone={meta.tone}>
            {meta.icon}
            {meta.short}
          </Pill>
        </div>
        {example && (
          <form action={switchPersonaAction.bind(null, "student", example.student.id)}>
            <button type="submit" className="rounded text-xs font-medium text-primary hover:underline">
              Open as {example.student.name} →
            </button>
          </form>
        )}
      </header>
      {example ? (
        // `inert` keeps the embedded screen read-only: it is a live render, but
        // actions belong to the real pages of the student shown.
        <div inert className="bg-background p-4 sm:p-5">
          {screen === "home" ? (
            <StudentHome student={example.student} views={example.views} now={now} />
          ) : (
            <BadgeDetail view={example.focus} student={example.student} now={now} showBack={false} />
          )}
        </div>
      ) : (
        <div className="p-5">
          <EmptyState title="No student is in this state right now">
            The demo data has moved on. Reset the demo data from the guided demo page to restore an example of every
            state.
          </EmptyState>
        </div>
      )}
    </section>
  );
}
