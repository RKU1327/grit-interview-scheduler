import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AttemptPill, JourneyPill, PhasePill } from "@/components/app/status";
import { DefList, PageHeader, Panel } from "@/components/app/ui";
import { NullifiedMessage, PendingMessage, ResultMessage } from "@/components/student/messages";
import { getDb } from "@/db";
import { getNow } from "@/domain/core";
import { appointmentPhase, getStudentBadgeViews } from "@/domain/queries";
import { getPersona } from "@/lib/persona";
import { fmtDate, fmtDateLong, fmtRange, fmtStamp } from "@/lib/time";

export const metadata: Metadata = { title: "Interview result" };

const NEXT_STEPS = {
  pass: [
    "Your badge is recorded on your profile and counts as earned.",
    "Keep clearing skill contests to become eligible for your next Track Badge interview.",
  ],
  fail: [
    "Your cleared skills are not affected.",
    "You cannot book another interview for this badge yourself. If the GRIT interview team opens a new attempt, a booking button appears on your badge page.",
    "This result stays in your interview history.",
  ],
  retake_later: [
    "A retake is not a fail: no decision was made on the badge.",
    "From the date shown above you can book a new slot yourself from your badge page.",
    "This attempt stays in your history; the retake is counted as a new attempt.",
  ],
} as const;

export default async function ResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const { student } = await getPersona();
  const db = (await getDb());
  const now = (await getNow(db));
  // Looking the attempt up through the student's own views doubles as the ownership check.
  const view = (await getStudentBadgeViews(db, student.id, now)).find((v) => v.attempts.some((a) => a.id === attemptId));
  const attempt = view?.attempts.find((a) => a.id === attemptId);
  if (!view || !attempt) notFound();

  const firstName = student.name.split(" ")[0];
  const interview = attempt.appointments.find((p) => p.status === "completed") ?? attempt.appointments[0];
  const awardedByThis = view.award?.attemptId === attempt.id;
  const nullified = awardedByThis && view.award?.status === "nullified";

  return (
    <div data-testid="result-page">
      <PageHeader
        back={{ href: `/student/badges/${view.badge.slug}`, label: view.badge.name }}
        eyebrow={<JourneyPill state={view.journey} />}
        title={`Interview result · attempt ${attempt.attemptNo}`}
        description={view.badge.name}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {nullified && <NullifiedMessage view={view} />}
          {attempt.outcome ? (
            <div className={nullified ? "opacity-70" : undefined}>
              {nullified && (
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Original interview result (kept on record)
                </p>
              )}
              <ResultMessage view={view} firstName={firstName} attempt={attempt} onBadgePage />
            </div>
          ) : (
            <PendingMessage view={view} />
          )}

          {attempt.outcome && !nullified && (
            <Panel title="What this means">
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/80">
                {NEXT_STEPS[attempt.outcome.outcome].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Bookings in this attempt" bodyClassName="p-0">
            <ul className="divide-y">
              {attempt.appointments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    {fmtDate(p.startsAt)} · {fmtRange(p.startsAt, p.endsAt)}
                    <span className="text-muted-foreground"> · {p.interviewerName}</span>
                  </span>
                  <PhasePill phase={appointmentPhase(p, now)} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel title="Details">
          <DefList
            items={[
              ["Badge", view.badge.name],
              ["Attempt", `#${attempt.attemptNo}`],
              ["Status", <AttemptPill key="s" status={attempt.status} />],
              ["Interview", interview ? fmtDateLong(interview.startsAt) : "–"],
              ["Time", interview ? fmtRange(interview.startsAt, interview.endsAt) : "–"],
              ["Interviewer", interview?.interviewerName ?? "–"],
              ["Published", attempt.outcome ? fmtStamp(attempt.outcome.recordedAt) : "Not yet"],
              [
                "Badge",
                awardedByThis
                  ? nullified
                    ? `Nullified ${view.nullifiedAt ? fmtDate(view.nullifiedAt) : ""}`
                    : `Earned ${fmtDate(view.award!.awardedAt)}`
                  : "Not awarded",
              ],
            ]}
          />
          {attempt.wasCorrected && (
            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              This result was corrected by the GRIT interview team. The result shown is the current one.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
