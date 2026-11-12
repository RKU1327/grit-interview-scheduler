import type { Metadata } from "next";
import { FlaskConical, RotateCcw } from "lucide-react";
import { resetDemoAction, setDemoClockAction, switchPersonaAction } from "@/app/actions";
import { ActionButton } from "@/components/app/action-button";
import { PageHeader, Panel } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getClockOffsetMs, getNow } from "@/domain/core";
import { getOverview } from "@/domain/queries";
import { fmtStamp } from "@/lib/time";

export const metadata: Metadata = { title: "Guided demo" };

type Step = { title: string; body: string; persona: ["student" | "interviewer" | "team", string | undefined, string] };

const JOURNEY: Step[] = [
  {
    title: "Become eligible",
    body: "As Mira Notyet, open the Full-Stack Web badge. She is one skill short, so there is no way to book. Use the demo control to clear “React”: the eligibility message appears and booking unlocks.",
    persona: ["student", "stu_mira", "Open as Mira Notyet"],
  },
  {
    title: "Book a real slot",
    body: "Still as Mira, choose “Book your interview”, pick a date and a 30-minute slot, review the time zone, and confirm. The home screen now shows the booking-confirmed message and the upcoming interview.",
    persona: ["student", "stu_mira", "Continue as Mira Notyet"],
  },
  {
    title: "See it reach the interviewer and the team",
    body: "Switch to the interviewer you booked with: the interview is on their daily schedule for that date. Switch to the Interview Team: Mira is on the eligible roster as “Booked”, and the overview counts have moved.",
    persona: ["interviewer", "int_priya", "Open as Priya Panelist"],
  },
  {
    title: "Record a result",
    body: "As the interviewer, open the interview. Results cannot be entered before the start time, so use “Demo: jump clock to interview start”, then publish Pass. (Dev Pending already has an interview awaiting a result if you prefer not to move the clock.)",
    persona: ["interviewer", "int_priya", "Open as Priya Panelist"],
  },
  {
    title: "Student sees the outcome",
    body: "Back as the student: the home screen and badge screen show the result message and the badge as earned. Try Fail or Retake later on another student to see the distinct next steps (Rohan Failed, Neha Retake).",
    persona: ["student", "stu_mira", "Open as Mira Notyet"],
  },
  {
    title: "Reschedule or cancel",
    body: "As Tara Booked, reschedule or cancel her interview. The original booking stays in her history, the slot is released, and the interviewer schedule and team views update.",
    persona: ["student", "stu_tara", "Open as Tara Booked"],
  },
  {
    title: "Nullify a badge for malpractice",
    body: "As the Interview Team, open Badges and nullify Isha Passed's badge with a reason. Then view Isha as a student: the badge is explicitly nullified, while the pass and the award remain in the activity history.",
    persona: ["team", undefined, "Open as Interview Team"],
  },
  {
    title: "Compare before and after",
    body: "As any student, open “Before / after” to see the home and badge screens for every state side by side, rendered from live records.",
    persona: ["student", "stu_kabir", "Open as Kabir Eligible"],
  },
];

const PEOPLE: [string, string, string][] = [
  ["stu_mira", "Mira Notyet", "Not yet eligible (one skill short)"],
  ["stu_kabir", "Kabir Eligible", "Just became eligible, not booked"],
  ["stu_tara", "Tara Booked", "Interview booked for tomorrow"],
  ["stu_dev", "Dev Pending", "Interview done, outcome pending"],
  ["stu_isha", "Isha Passed", "Passed, badge earned"],
  ["stu_rohan", "Rohan Failed", "Failed"],
  ["stu_neha", "Neha Retake", "Retake later (can re-book)"],
  ["stu_arjun", "Arjun Nullified", "Badge earned, then nullified"],
  ["stu_zoya", "Zoya Secondtry", "Failed attempt 1, attempt 2 booked"],
  ["stu_sam", "Sam Unbooked", "Eligible, cancelled, not re-booked"],
  ["stu_lina", "Lina Rescheduled", "Booked after a reschedule"],
  ["stu_pia", "Pia Noshow", "No-show, needs to re-book"],
];

export default async function DemoPage() {
  const db = getDb();
  const now = getNow(db);
  const shifted = Math.abs(getClockOffsetMs(db)) > 1000;
  const o = getOverview(db, now);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-slate-900">
            <FlaskConical className="size-3" aria-hidden /> Demo mode
          </span>
        }
        title="Guided demo"
        description="A walk through the whole workflow. All people and records are fictional. There is no sign-in: the bar at the top switches between the three personas."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Panel title="Demo journey" description="Eight steps that each change real state. Follow them in order after a reset.">
          <ol className="space-y-5">
            {JOURNEY.map((s, i) => (
              <li key={s.title} className="flex gap-3.5">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                  <form action={switchPersonaAction.bind(null, s.persona[0], s.persona[1])} className="mt-2">
                    <Button type="submit" variant="outline" size="sm" data-testid={`demo-step-${i + 1}`}>
                      {s.persona[2]}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="space-y-6">
          <Panel title="Demo data" description="Current state of the seeded records.">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ["Eligible", o.eligible],
                ["Not booked", o.unbooked],
                ["Booked", o.booked],
                ["Outcome pending", o.outcomePending],
                ["Completed", o.completed],
                ["Badges nullified", o.badgesNullified],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t pt-4">
              <ActionButton
                action={resetDemoAction}
                variant="outline"
                testId="reset-demo"
                confirm={{
                  title: "Reset all demo data?",
                  description:
                    "Every booking, outcome and change you made is discarded and the seeded fixtures are recreated relative to the current time. The demo clock returns to real time.",
                  confirmLabel: "Reset demo data",
                  destructive: true,
                }}
              >
                <RotateCcw aria-hidden /> Reset demo data
              </ActionButton>
            </div>
          </Panel>

          <Panel title="Demo clock" description="Rules such as “no result before the interview starts” use this clock.">
            <p className="text-sm">
              <span className="text-muted-foreground">Current demo time: </span>
              <span className="font-medium">{fmtStamp(now)}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {shifted
                ? "The clock has been moved forward. Interviews whose time has now passed show as awaiting an outcome."
                : "Running on real time. Jump forward from an interview page to make a booked interview recordable."}
            </p>
            {shifted && (
              <div className="mt-3">
                <ActionButton action={setDemoClockAction.bind(null, null)} variant="outline" size="sm" testId="clock-reset">
                  Back to real time
                </ActionButton>
              </div>
            )}
          </Panel>

          <Panel title="Who demonstrates what" bodyClassName="p-0">
            <ul className="divide-y text-sm">
              {PEOPLE.map(([id, name, what]) => (
                <li key={id}>
                  <form action={switchPersonaAction.bind(null, "student", id)}>
                    <button type="submit" className="flex w-full items-baseline justify-between gap-3 px-5 py-2 text-left hover:bg-muted/50">
                      <span className="font-medium">{name}</span>
                      <span className="text-right text-xs text-muted-foreground">{what}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
