import Link from "next/link";
import { CalendarX, Check, Circle, FlaskConical, History, Repeat } from "lucide-react";
import { cancelAppointmentAction, clearSkillAction } from "@/app/actions";
import { ActionButton } from "@/components/app/action-button";
import { AttemptPill, JourneyPill, PhasePill } from "@/components/app/status";
import { DefList, EmptyState, LinkButton, PageHeader, Panel } from "@/components/app/ui";
import { POLICY, type JourneyState } from "@/domain/policy";
import { appointmentPhase, type StudentBadgeView } from "@/domain/queries";
import { fmtDate, fmtDateLong, fmtRange, fmtStamp, TZ_LONG } from "@/lib/time";
import { cn } from "@/lib/utils";
import { JourneyMessage } from "./messages";

const STEPS = ["Clear required skills", "Book interview", "Attend interview", "Badge decision"] as const;

/** How many of the four steps are complete, and how the last one ended. */
function stepProgress(journey: JourneyState): { done: number; end?: { label: string; bad?: boolean } } {
  switch (journey) {
    case "locked":
      return { done: 0 };
    case "eligible_unbooked":
      return { done: 1 };
    case "booked":
      return { done: 2 };
    case "awaiting_outcome":
      return { done: 3 };
    case "passed":
      return { done: 4, end: { label: "Badge earned" } };
    case "failed":
      return { done: 4, end: { label: "Not passed", bad: true } };
    case "retake_later":
      return { done: 4, end: { label: "Retake needed", bad: true } };
    case "nullified":
      return { done: 4, end: { label: "Badge nullified", bad: true } };
  }
}

/**
 * Badge / interview screen. Pure function of one StudentBadgeView; shared by
 * the live badge page and the before/after preview.
 */
export function BadgeDetail({
  view,
  student,
  now,
  showBack = true,
}: {
  view: StudentBadgeView;
  student: { name: string };
  now: Date;
  showBack?: boolean;
}) {
  const { badge, journey, activeAppointment: appt, change } = view;
  const firstName = student.name.split(" ")[0];
  const steps = stepProgress(journey);
  const missing = view.skills.filter((s) => !s.clearedAt);

  return (
    <div className="@container" data-testid="badge-detail" data-journey={journey}>
      <PageHeader
        back={showBack ? { href: "/student", label: "Home" } : undefined}
        eyebrow={<JourneyPill state={journey} />}
        title={badge.name}
        description={badge.description}
      />

      <ol className="mb-6 grid grid-cols-2 gap-2 @2xl:grid-cols-4" aria-label="Badge journey">
        {STEPS.map((label, i) => {
          const complete = i < steps.done;
          const current = i === steps.done;
          const isEnd = i === 3 && steps.end;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
                complete && !isEnd && "border-emerald-200 bg-emerald-50/60",
                isEnd && (steps.end?.bad ? "border-rose-200 bg-rose-50/60" : "border-emerald-300 bg-emerald-50"),
                current && "border-primary/40 bg-accent",
                !complete && !current && "bg-card text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold",
                  complete ? (isEnd && steps.end?.bad ? "bg-rose-600 text-white" : "bg-emerald-600 text-white") : current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
                aria-hidden
              >
                {complete && !(isEnd && steps.end?.bad) ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="font-medium">{isEnd ? steps.end?.label : label}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 @4xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <JourneyMessage view={view} firstName={firstName} onBadgePage />

          {appt && change && (
            <Panel
              title="Your booking"
              description={`All times in ${TZ_LONG}.`}
              action={<PhasePill phase={appointmentPhase(appt, now)} />}
              data-testid="booking-panel"
            >
              <DefList
                items={[
                  ["Date", fmtDateLong(appt.startsAt)],
                  ["Time", fmtRange(appt.startsAt, appt.endsAt)],
                  ["Interviewer", appt.interviewerName],
                  ["Attempt", `#${appt.attemptNo}`],
                  ["Booked on", fmtStamp(appt.bookedAt)],
                ]}
              />
              <div className="mt-5 rounded-lg bg-muted/60 p-3.5 text-sm">
                <p className="font-medium">Changing your booking</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>
                    You can reschedule or cancel until <strong className="font-medium text-foreground">{fmtStamp(change.deadline)}</strong>{" "}
                    ({POLICY.changeCutoffMinutes / 60} hours before the start).
                  </li>
                  <li>
                    Reschedules left for this attempt:{" "}
                    <strong className="font-medium text-foreground">
                      {change.reschedulesLeft} of {POLICY.maxReschedulesPerAttempt}
                    </strong>
                    .
                  </li>
                  <li>Cancelling releases the slot. You stay eligible and can book again.</li>
                </ul>
              </div>
              {change.allowed ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {change.reschedulesLeft > 0 && (
                    <LinkButton
                      href={`/student/badges/${badge.slug}/book?reschedule=${appt.id}`}
                      variant="outline"
                      data-testid="reschedule-link"
                    >
                      <Repeat aria-hidden /> Reschedule
                    </LinkButton>
                  )}
                  <ActionButton
                    action={cancelAppointmentAction.bind(null, appt.id)}
                    variant="outline"
                    className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    testId="cancel-booking"
                    confirm={{
                      title: "Cancel this interview?",
                      description: (
                        <>
                          Your slot on <strong>{fmtDateLong(appt.startsAt)}</strong> at{" "}
                          <strong>{fmtRange(appt.startsAt, appt.endsAt)}</strong> will be released to other students. You stay
                          eligible and can book a new slot at any time.
                        </>
                      ),
                      confirmLabel: "Cancel interview",
                      destructive: true,
                      reason: { label: "Reason (optional)", placeholder: "e.g. clashes with an exam", help: "Optional. Shared with the interview team." },
                    }}
                  >
                    <CalendarX aria-hidden /> Cancel booking
                  </ActionButton>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  The change window for this interview has closed. If you cannot attend, contact the GRIT interview team.
                </p>
              )}
            </Panel>
          )}

          <Panel title="Interview history" description="Every attempt and booking change is kept, including cancelled and rescheduled slots.">
            {view.attempts.length === 0 ? (
              <EmptyState icon={<History />} title="No interviews yet">
                {journey === "locked"
                  ? "Your attempts will be listed here once you become eligible and book an interview."
                  : "Book your first interview and it will show up here."}
              </EmptyState>
            ) : (
              <ol className="space-y-4" data-testid="attempt-history">
                {view.attempts.map((a) => (
                  <li key={a.id} className="rounded-lg border" data-testid={`attempt-${a.attemptNo}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
                      <p className="text-sm font-semibold">Attempt {a.attemptNo}</p>
                      <div className="flex items-center gap-2">
                        <AttemptPill status={a.status} />
                        {a.outcome && (
                          <Link href={`/student/results/${a.id}`} className="rounded text-xs font-medium text-primary hover:underline">
                            View result
                          </Link>
                        )}
                      </div>
                    </div>
                    <ul className="divide-y">
                      {a.appointments.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                          <span>
                            {fmtDate(p.startsAt)} · {fmtRange(p.startsAt, p.endsAt)}
                            <span className="text-muted-foreground"> · {p.interviewerName}</span>
                          </span>
                          <PhasePill phase={appointmentPhase(p, now)} />
                        </li>
                      ))}
                    </ul>
                    {a.outcome && (
                      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                        Result published {fmtStamp(a.outcome.recordedAt)}
                        {a.wasCorrected && " · corrected by the interview team"}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            id="skills"
            title="Required skills"
            description={`${view.progress.clearedCount} of ${view.progress.requiredCount} cleared`}
          >
            <ul className="space-y-2.5" data-testid="skill-list">
              {view.skills.map((s) => (
                <li key={s.id} className="flex items-start gap-2.5 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                      s.clearedAt ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {s.clearedAt ? <Check className="size-3" /> : <Circle className="size-3" />}
                  </span>
                  <span>
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.clearedAt ? `Cleared ${fmtDate(s.clearedAt)}` : "Skill contest not cleared yet"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {view.eligibleAt && (
              <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                Eligible for the interview since {fmtStamp(view.eligibleAt)}.
              </p>
            )}
          </Panel>

          {journey === "locked" && missing.length > 0 && (
            <Panel
              className="border-dashed border-amber-300 bg-amber-50/40"
              title={
                <span className="inline-flex items-center gap-1.5">
                  <FlaskConical className="size-3.5" aria-hidden /> Demo control
                </span>
              }
              description="Stands in for the skill-contest system reporting a cleared contest."
            >
              <div className="space-y-2">
                {missing.map((s) => (
                  <ActionButton
                    key={s.id}
                    action={clearSkillAction.bind(null, s.id)}
                    variant="outline"
                    className="w-full justify-start bg-card"
                    testId={`clear-skill-${s.code}`}
                  >
                    Simulate clearing “{s.name}”
                  </ActionButton>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
