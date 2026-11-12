import {
  Award,
  Ban,
  CalendarCheck,
  CalendarPlus,
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  Lock,
  Repeat,
  RotateCcw,
  ShieldOff,
  UserX,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AttemptStatus, Outcome } from "@/db/schema";
import type { JourneyState } from "@/domain/policy";
import type { AppointmentPhase } from "@/domain/queries";
import { Pill, type Tone } from "./ui";

export const JOURNEY_META: Record<JourneyState, { label: string; tone: Tone; icon: ReactNode; short: string }> = {
  locked: { label: "Not eligible yet", short: "Before eligibility", tone: "neutral", icon: <Lock /> },
  eligible_unbooked: { label: "Eligible · interview not booked", short: "Eligible, unbooked", tone: "info", icon: <CalendarPlus /> },
  booked: { label: "Interview booked", short: "Booked", tone: "info", icon: <CalendarCheck /> },
  awaiting_outcome: { label: "Result pending", short: "Result pending", tone: "warning", icon: <Hourglass /> },
  passed: { label: "Badge earned", short: "Passed · earned", tone: "success", icon: <Award /> },
  failed: { label: "Interview not passed", short: "Failed", tone: "danger", icon: <CircleX /> },
  retake_later: { label: "Retake needed", short: "Retake later", tone: "violet", icon: <RotateCcw /> },
  nullified: { label: "Badge nullified", short: "Nullified", tone: "danger", icon: <ShieldOff /> },
};

export function JourneyPill({ state }: { state: JourneyState }) {
  const m = JOURNEY_META[state];
  return (
    <Pill tone={m.tone} data-journey={state}>
      {m.icon}
      {m.label}
    </Pill>
  );
}

export const PHASE_META: Record<AppointmentPhase, { label: string; tone: Tone; icon: ReactNode }> = {
  scheduled: { label: "Scheduled", tone: "info", icon: <CalendarCheck /> },
  in_progress: { label: "In progress", tone: "info", icon: <Video /> },
  outcome_pending: { label: "Outcome pending", tone: "warning", icon: <Hourglass /> },
  completed: { label: "Completed", tone: "success", icon: <CircleCheck /> },
  cancelled: { label: "Cancelled", tone: "neutral", icon: <Ban /> },
  rescheduled: { label: "Rescheduled", tone: "neutral", icon: <Repeat /> },
  no_show: { label: "Student no-show", tone: "warning", icon: <UserX /> },
  interviewer_absent: { label: "Interviewer absent", tone: "warning", icon: <UserX /> },
};

export function PhasePill({ phase }: { phase: AppointmentPhase }) {
  const m = PHASE_META[phase];
  return (
    <Pill tone={m.tone}>
      {m.icon}
      {m.label}
    </Pill>
  );
}

export const OUTCOME_META: Record<Outcome, { label: string; tone: Tone; icon: ReactNode }> = {
  pass: { label: "Pass", tone: "success", icon: <CircleCheck /> },
  fail: { label: "Fail", tone: "danger", icon: <CircleX /> },
  retake_later: { label: "Retake later", tone: "violet", icon: <RotateCcw /> },
};

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  const m = OUTCOME_META[outcome];
  return (
    <Pill tone={m.tone}>
      {m.icon}
      {m.label}
    </Pill>
  );
}

const ATTEMPT_META: Record<AttemptStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  awaiting_interview: { label: "Awaiting interview", tone: "info", icon: <Clock /> },
  awaiting_outcome: { label: "Awaiting outcome", tone: "warning", icon: <Hourglass /> },
  passed: OUTCOME_META.pass,
  failed: OUTCOME_META.fail,
  retake_later: OUTCOME_META.retake_later,
};

export function AttemptPill({ status }: { status: AttemptStatus }) {
  const m = ATTEMPT_META[status];
  return (
    <Pill tone={m.tone}>
      {m.icon}
      {m.label}
    </Pill>
  );
}
