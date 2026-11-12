import { Award, CalendarCheck, CalendarPlus, CircleX, Hourglass, Lock, RotateCcw, ShieldOff, Unlock } from "lucide-react";
import { Callout, LinkButton } from "@/components/app/ui";
import type { StudentBadgeView } from "@/domain/queries";
import { fill, KEY_MESSAGES, NULLIFIED_MESSAGE } from "@/lib/messages";
import { fmtDate, fmtDateLong, fmtStamp, fmtTime } from "@/lib/time";

const badgeHref = (v: StudentBadgeView) => `/student/badges/${v.badge.slug}`;

/** Key message 1 of 3: eligibility earned. */
export function EligibilityMessage({ view }: { view: StudentBadgeView }) {
  const m = KEY_MESSAGES.eligibility;
  const vars = { badgeName: view.badge.name, skillCount: view.progress.requiredCount };
  return (
    <Callout
      tone="info"
      icon={<Unlock />}
      testId="msg-eligibility"
      title={fill(m.title, vars)}
      actions={
        <LinkButton href={`${badgeHref(view)}/book`} size="lg" data-testid="cta-book">
          <CalendarPlus aria-hidden /> {m.cta}
        </LinkButton>
      }
    >
      {fill(m.body, vars)}
    </Callout>
  );
}

/** Key message 2 of 3: booking confirmed. */
export function BookingConfirmedMessage({ view, compact }: { view: StudentBadgeView; compact?: boolean }) {
  const a = view.activeAppointment;
  if (!a || !view.change) return null;
  const m = KEY_MESSAGES.bookingConfirmed;
  const vars = {
    badgeName: view.badge.name,
    interviewerName: a.interviewerName,
    date: fmtDate(a.startsAt),
    weekdayDate: fmtDateLong(a.startsAt),
    startTime: fmtTime(a.startsAt),
    endTime: fmtTime(a.endsAt),
    changeDeadline: fmtStamp(view.change.deadline),
  };
  return (
    <Callout
      tone="info"
      icon={<CalendarCheck />}
      testId="msg-booking-confirmed"
      title={fill(m.title, vars)}
      actions={
        compact ? (
          <LinkButton href={badgeHref(view)} variant="outline" className="bg-card">
            {m.cta}
          </LinkButton>
        ) : undefined
      }
    >
      {fill(m.body, vars)}
    </Callout>
  );
}

/** Key message 3 of 3: result published (pass / fail / retake later). */
export function ResultMessage({
  view,
  firstName,
  onBadgePage,
  attempt: chosen,
}: {
  view: StudentBadgeView;
  firstName: string;
  onBadgePage?: boolean;
  /** Defaults to the latest attempt with a result. */
  attempt?: StudentBadgeView["attempts"][number];
}) {
  const attempt = chosen ?? view.lastFinal;
  if (!attempt?.outcome) return null;
  const isLatest = attempt.id === view.lastFinal?.id;
  const outcome = attempt.outcome.outcome;
  const m = KEY_MESSAGES.result[outcome];
  const interviewAt = attempt.appointments.find((p) => p.status === "completed")?.startsAt ?? attempt.outcome.recordedAt;
  const vars = {
    badgeName: view.badge.name,
    firstName,
    interviewDate: fmtDate(interviewAt),
    retakeDate: attempt.retakeAvailableAt ? fmtDate(attempt.retakeAvailableAt) : "the date shown on this page",
  };
  const tone = outcome === "pass" ? "success" : outcome === "fail" ? "danger" : "violet";
  const icon = outcome === "pass" ? <Award /> : outcome === "fail" ? <CircleX /> : <RotateCcw />;
  const cta = !isLatest ? null : outcome === "retake_later" ? (
      view.gate.allowed ? (
        <LinkButton href={`${badgeHref(view)}/book`} data-testid="cta-book">
          <CalendarPlus aria-hidden /> {m.cta}
        </LinkButton>
      ) : null
    ) : outcome === "pass" ? (
      onBadgePage ? null : (
        <LinkButton href={badgeHref(view)}>{m.cta}</LinkButton>
      )
    ) : (
      <LinkButton href={`${badgeHref(view)}#skills`} variant="outline" className="bg-card">
        {m.cta}
      </LinkButton>
    );
  return (
    <Callout
      tone={tone}
      icon={icon}
      testId={`msg-result-${outcome}`}
      title={fill(m.title, vars)}
      actions={
        cta || !onBadgePage ? (
          <>
            {cta}
            {!onBadgePage && (
              <LinkButton href={`/student/results/${attempt.id}`} variant="ghost">
                See full result
              </LinkButton>
            )}
          </>
        ) : undefined
      }
    >
      {fill(m.body, vars)}
    </Callout>
  );
}

export function NullifiedMessage({ view }: { view: StudentBadgeView }) {
  if (!view.award || !view.nullifiedAt) return null;
  const vars = {
    badgeName: view.badge.name,
    awardedDate: fmtDate(view.award.awardedAt),
    nullifiedDate: fmtDate(view.nullifiedAt),
  };
  return (
    <Callout tone="danger" icon={<ShieldOff />} testId="msg-nullified" title={fill(NULLIFIED_MESSAGE.title, vars)}>
      {fill(NULLIFIED_MESSAGE.body, vars)}
    </Callout>
  );
}

export function PendingMessage({ view }: { view: StudentBadgeView }) {
  const last = view.attempts[0]?.appointments.find((p) => p.status === "scheduled" || p.status === "completed");
  return (
    <Callout
      tone="warning"
      icon={<Hourglass />}
      testId="msg-pending"
      title={`Your ${view.badge.name} result is pending`}
    >
      {last ? `Your interview with ${last.interviewerName} was scheduled for ${fmtDateLong(last.startsAt)} at ${fmtTime(last.startsAt)} IST. ` : ""}
      Your interviewer has not recorded the result yet. It will appear here as soon as they do. There is nothing you need
      to do right now.
    </Callout>
  );
}

export function LockedMessage({ view }: { view: StudentBadgeView }) {
  const missing = view.skills.filter((s) => !s.clearedAt);
  return (
    <Callout
      tone="neutral"
      icon={<Lock />}
      testId="msg-locked"
      title={`${missing.length} skill${missing.length === 1 ? "" : "s"} to go before your ${view.badge.name} interview`}
    >
      The interview unlocks automatically when you have cleared every required skill contest. Still to clear:{" "}
      <strong className="font-semibold">{missing.map((s) => s.name).join(", ")}</strong>.
    </Callout>
  );
}

/** Routine feedback (not a key message): an open attempt whose booking was closed without an outcome. */
export function RebookMessage({ view }: { view: StudentBadgeView }) {
  const closed = view.attempts[0]?.appointments[0];
  if (!closed) return null;
  const why =
    closed.status === "no_show"
      ? "You were marked as not attending your last interview slot."
      : closed.status === "interviewer_absent"
        ? "Your interviewer could not attend your last interview slot. We are sorry about that."
        : closed.closedBy === "student"
          ? "You cancelled your previous booking."
          : "Your previous booking was cancelled because the interviewer is no longer available at that time.";
  return (
    <Callout
      tone="info"
      icon={<CalendarPlus />}
      testId="msg-rebook"
      title={`Book a new slot for your ${view.badge.name} interview`}
      actions={
        <LinkButton href={`${badgeHref(view)}/book`} size="lg" data-testid="cta-book">
          <CalendarPlus aria-hidden /> Book your interview
        </LinkButton>
      }
    >
      {why} No result was recorded, so this does not count as an attempt outcome. You are still eligible: choose a new
      slot when you are ready.
    </Callout>
  );
}

export function GrantMessage({ view }: { view: StudentBadgeView }) {
  return (
    <Callout
      tone="info"
      icon={<Unlock />}
      testId="msg-grant"
      title="A new interview attempt has been opened for you"
      actions={
        <LinkButton href={`${badgeHref(view)}/book`} data-testid="cta-book">
          <CalendarPlus aria-hidden /> Book your interview
        </LinkButton>
      }
    >
      The GRIT interview team has allowed another attempt at the {view.badge.name} interview. Your earlier result stays in
      your history.
    </Callout>
  );
}

/** The one message that best describes where the student is for this badge. */
export function JourneyMessage({ view, firstName, onBadgePage }: { view: StudentBadgeView; firstName: string; onBadgePage?: boolean }) {
  switch (view.journey) {
    case "locked":
      return <LockedMessage view={view} />;
    case "eligible_unbooked":
      return view.attempts.length > 0 ? <RebookMessage view={view} /> : <EligibilityMessage view={view} />;
    case "booked":
      return <BookingConfirmedMessage view={view} compact={!onBadgePage} />;
    case "awaiting_outcome":
      return <PendingMessage view={view} />;
    case "nullified":
      return <NullifiedMessage view={view} />;
    case "failed":
      return (
        <div className="space-y-3">
          <ResultMessage view={view} firstName={firstName} onBadgePage={onBadgePage} />
          {view.hasGrant && <GrantMessage view={view} />}
        </div>
      );
    default:
      return <ResultMessage view={view} firstName={firstName} onBadgePage={onBadgePage} />;
  }
}
