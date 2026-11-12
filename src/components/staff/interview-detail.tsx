import Link from "next/link";
import { Check, Circle, FlaskConical, Info, Lock } from "lucide-react";
import {
  cancelAppointmentAction,
  jumpToAppointmentAction,
  markAbsenceAction,
  markConductedAction,
} from "@/app/actions";
import { ActionButton } from "@/components/app/action-button";
import { AttemptPill, OutcomePill, PhasePill } from "@/components/app/status";
import { Callout, DefList, PageHeader, Panel, Timeline } from "@/components/app/ui";
import type { DbOrTx } from "@/db";
import type { Outcome } from "@/db/schema";
import { loadBadgeContext } from "@/domain/core";
import { CORRECTION_TRANSITIONS, humanize, isFinalAttempt, OUTCOME_TO_STATUS, POLICY } from "@/domain/policy";
import { appointmentPhase, getAppointmentDetail } from "@/domain/queries";
import { fmtDate, fmtDateLong, fmtRange, fmtStamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { OutcomeForm } from "./outcome-form";

type Detail = NonNullable<ReturnType<typeof getAppointmentDetail>>;

/** Interview detail shared by the interviewer and the interview team. */
export function InterviewDetail({
  db,
  detail,
  role,
  now,
  back,
}: {
  db: DbOrTx;
  detail: Detail;
  role: "interviewer" | "team";
  now: Date;
  back: { href: string; label: string };
}) {
  const { appt, outcomes, siblings, priorAttempts, award, events } = detail;
  const ctx = loadBadgeContext(db, appt.studentId, appt.badgeId, now);
  const phase = appointmentPhase(appt, now);
  const current = outcomes.find((o) => o.isCurrent) ?? null;
  const final = isFinalAttempt(appt.attemptStatus);
  const started = now >= new Date(appt.startsAt);
  const live = appt.status === "scheduled" || appt.status === "completed";
  const graceOver = now.getTime() >= Date.parse(appt.startsAt) + POLICY.noShowGraceMinutes * 60_000;
  const isLatestAttempt = priorAttempts.at(-1)?.id === appt.attemptId;
  const correctable = (Object.keys(OUTCOME_TO_STATUS) as Outcome[]).filter((o) =>
    CORRECTION_TRANSITIONS[appt.attemptStatus].includes(OUTCOME_TO_STATUS[o]),
  );
  const isOutcomeAppointment = current?.appointmentId === appt.id;

  return (
    <div data-testid="interview-detail">
      <PageHeader
        back={back}
        eyebrow={<PhasePill phase={phase} />}
        title={`${appt.studentName} · ${appt.badgeName}`}
        description={`${fmtDateLong(appt.startsAt)} · ${fmtRange(appt.startsAt, appt.endsAt)} · attempt ${appt.attemptNo}`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_21rem]">
        <div className="space-y-6">
          <Panel
            title="Outcome"
            description={
              final
                ? "Finalised. The history below is the audit record."
                : "Pass, fail and retake later are distinct results with different next steps for the student."
            }
          >
            {final && current ? (
              <div className="space-y-4" data-testid="outcome-final">
                <div className="flex flex-wrap items-center gap-3">
                  <OutcomePill outcome={current.outcome} />
                  <span className="text-sm text-muted-foreground">
                    Recorded by {current.recordedByName} · {fmtStamp(current.recordedAt)}
                  </span>
                </div>
                {!isOutcomeAppointment && (
                  <p className="text-sm text-muted-foreground">
                    This outcome belongs to another booking in the same attempt; this booking is {humanize(appt.status)}.
                  </p>
                )}
                {current.privateNotes && (
                  <div className="rounded-lg bg-muted/60 p-3 text-sm">
                    <p className="mb-0.5 text-xs font-medium text-muted-foreground">Private notes · not visible to the student</p>
                    {current.privateNotes}
                  </div>
                )}
                {current.correctionReason && (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-200 ring-inset">
                    <p className="mb-0.5 text-xs font-medium text-amber-900">Correction reason</p>
                    {current.correctionReason}
                  </div>
                )}
                {outcomes.length > 1 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Outcome ledger (append-only)</p>
                    <ul className="divide-y rounded-lg border text-sm">
                      {outcomes.map((o) => (
                        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <span className="flex items-center gap-2">
                            <OutcomePill outcome={o.outcome} />
                            <span className={cn("text-xs", o.isCurrent ? "font-medium text-emerald-700" : "text-muted-foreground")}>
                              {o.isCurrent ? "Current" : "Superseded"}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {o.recordedByName} · {fmtStamp(o.recordedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {role === "interviewer"
                    ? "A published outcome cannot be changed by an interviewer. If it is wrong, ask the interview team to issue a correction."
                    : "Published outcomes are never overwritten. A correction adds a new ledger entry with your reason."}
                </p>
                {role === "team" && isLatestAttempt && correctable.length > 0 && (
                  <details className="rounded-lg border p-4">
                    <summary className="cursor-pointer text-sm font-medium">Issue a correction</summary>
                    <div className="mt-4">
                      <OutcomeForm
                        mode="correct"
                        appointmentId={appt.id}
                        attemptId={appt.attemptId}
                        studentName={appt.studentName}
                        allowed={correctable}
                        retakeWaitOptions={POLICY.retakeWaitOptions}
                        defaultRetakeWait={POLICY.defaultRetakeWaitDays}
                      />
                    </div>
                  </details>
                )}
                {role === "team" && current.outcome === "pass" && (
                  <p className="text-sm text-muted-foreground">
                    A pass cannot be corrected away. If malpractice is confirmed, nullify the badge from the{" "}
                    <Link href={`/team/students/${appt.studentId}`} className="font-medium text-primary hover:underline">
                      student record
                    </Link>
                    .
                  </p>
                )}
              </div>
            ) : !live ? (
              <Callout tone="neutral" icon={<Info />} title={`No outcome can be recorded: this booking is ${humanize(appt.status)}`} testId="outcome-blocked">
                {appt.closeReason ? `Reason on record: ${appt.closeReason}. ` : ""}
                Only an interview that actually took place can receive a result. The attempt stays open and the student can
                book a new slot.
              </Callout>
            ) : !started ? (
              <Callout
                tone="neutral"
                icon={<Lock />}
                title="Outcome recording opens when the interview starts"
                testId="outcome-too-early"
                actions={
                  <ActionButton
                    action={jumpToAppointmentAction.bind(null, appt.id)}
                    variant="outline"
                    className="border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    testId="jump-clock"
                  >
                    <FlaskConical aria-hidden /> Demo: jump clock to interview start
                  </ActionButton>
                }
              >
                This interview starts on {fmtStamp(appt.startsAt)}. Results cannot be entered before then, so a result can
                never be published for an interview that has not happened.
              </Callout>
            ) : (
              <div className="space-y-5">
                <OutcomeForm
                  mode="record"
                  appointmentId={appt.id}
                  attemptId={appt.attemptId}
                  studentName={appt.studentName}
                  retakeWaitOptions={POLICY.retakeWaitOptions}
                  defaultRetakeWait={POLICY.defaultRetakeWaitDays}
                />
                {appt.status === "scheduled" && (
                  <div className="border-t pt-4">
                    <p className="mb-2 text-sm font-medium">Did the interview not go ahead as planned?</p>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton action={markConductedAction.bind(null, appt.id)} variant="outline" testId="mark-conducted">
                        Mark conducted, decide later
                      </ActionButton>
                      <ActionButton
                        action={markAbsenceAction.bind(null, appt.id, "no_show")}
                        variant="outline"
                        disabled={!graceOver}
                        testId="mark-no-show"
                        confirm={{
                          title: "Record a student no-show?",
                          description:
                            "The booking is closed with no result. This is not a fail: the attempt stays open and the student can book another slot. The interview team can see no-shows.",
                          confirmLabel: "Record no-show",
                          reason: { label: "Note (optional)", placeholder: "e.g. waited 15 minutes", help: "Optional. Kept in the audit trail." },
                        }}
                      >
                        Student did not attend
                      </ActionButton>
                      {role === "team" && (
                        <ActionButton
                          action={markAbsenceAction.bind(null, appt.id, "interviewer_absent")}
                          variant="outline"
                          disabled={!graceOver}
                          testId="mark-interviewer-absent"
                          confirm={{
                            title: "Record that the interviewer was absent?",
                            description:
                              "The booking is closed with no result and no penalty for the student, who can book another slot straight away.",
                            confirmLabel: "Record interviewer absence",
                            reason: { label: "Note (optional)", help: "Optional. Kept in the audit trail." },
                          }}
                        >
                          Interviewer did not attend
                        </ActionButton>
                      )}
                    </div>
                    {!graceOver && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Attendance can be recorded {POLICY.noShowGraceMinutes} minutes after the scheduled start.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Activity" description="Every transition for this attempt, newest first.">
            <Timeline events={events} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Interview">
            <DefList
              items={[
                ["Student", role === "team" ? <Link key="s" href={`/team/students/${appt.studentId}`} className="text-primary hover:underline">{appt.studentName}</Link> : appt.studentName],
                ["Email", <span key="e" className="text-xs">{appt.studentEmail}</span>],
                ["Badge", appt.badgeName],
                ["Interviewer", appt.interviewerName],
                ["Attempt", <span key="a" className="inline-flex items-center gap-2">#{appt.attemptNo} <AttemptPill status={appt.attemptStatus} /></span>],
                ["Booked", fmtStamp(appt.bookedAt)],
                ...(award ? ([["Badge award", award.status === "active" ? `Earned ${fmtDate(award.awardedAt)}` : "Nullified"]] as [string, string][]) : []),
              ]}
            />
            {appt.status === "scheduled" && !started && (
              <div className="mt-4 border-t pt-4">
                <ActionButton
                  action={cancelAppointmentAction.bind(null, appt.id)}
                  variant="outline"
                  className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  testId="staff-cancel"
                  confirm={{
                    title: "Cancel this interview?",
                    description: `${appt.studentName} will see that the interview was cancelled and can book another slot. No result is recorded.`,
                    confirmLabel: "Cancel interview",
                    destructive: true,
                    reason: { label: "Reason", placeholder: "Shown to the interview team", minLength: 5, help: "Required. Kept in the audit trail." },
                  }}
                >
                  {role === "interviewer" ? "I can no longer take this interview" : "Cancel interview"}
                </ActionButton>
              </div>
            )}
          </Panel>

          <Panel title="Student context" description={`${ctx.progress.clearedCount} of ${ctx.progress.requiredCount} required skills cleared`}>
            <ul className="space-y-1.5 text-sm">
              {ctx.required.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  {s.clearedAt ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Circle className="size-3.5 text-muted-foreground" aria-hidden />}
                  <span>{s.name}</span>
                  {s.clearedAt && <span className="ml-auto text-xs text-muted-foreground">{fmtDate(s.clearedAt)}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-4 mb-1.5 border-t pt-3 text-xs font-medium text-muted-foreground">Attempts for this badge</p>
            <ul className="space-y-1.5 text-sm">
              {priorAttempts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className={a.id === appt.attemptId ? "font-medium" : undefined}>
                    Attempt {a.attemptNo}
                    {a.id === appt.attemptId && " (this one)"}
                  </span>
                  <AttemptPill status={a.status} />
                </li>
              ))}
            </ul>
            {siblings.length > 1 && (
              <>
                <p className="mt-4 mb-1.5 border-t pt-3 text-xs font-medium text-muted-foreground">Bookings in this attempt</p>
                <ul className="space-y-1.5 text-sm">
                  {siblings.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span className={p.id === appt.id ? "font-medium" : "text-muted-foreground"}>
                        {fmtDate(p.startsAt)} · {fmtRange(p.startsAt, p.endsAt).replace(" IST", "")}
                      </span>
                      <PhasePill phase={appointmentPhase(p, now)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
