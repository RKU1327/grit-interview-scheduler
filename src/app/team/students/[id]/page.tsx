import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { grantReattemptAction } from "@/app/actions";
import { ActionButton } from "@/components/app/action-button";
import { AttemptPill, JourneyPill, PhasePill } from "@/components/app/status";
import { PageHeader, Panel, Timeline } from "@/components/app/ui";
import { NullifyButton } from "@/components/staff/nullify-button";
import { getDb } from "@/db";
import { students } from "@/db/schema";
import { getNow } from "@/domain/core";
import { POLICY } from "@/domain/policy";
import { appointmentPhase, getStudentBadgeViews, listAudit, NEXT_ACTION } from "@/domain/queries";
import { fmtDate, fmtRange, fmtStamp } from "@/lib/time";

export const metadata: Metadata = { title: "Student record" };

export default async function TeamStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const student = db.select().from(students).where(eq(students.id, id)).get();
  if (!student) notFound();
  const now = getNow(db);
  const views = getStudentBadgeViews(db, student.id, now);
  const events = listAudit(db, { studentId: student.id });

  return (
    <div data-testid="team-student">
      <PageHeader
        back={{ href: "/team/roster", label: "Eligible students" }}
        title={student.name}
        description={`${student.email} · ${student.cohort}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {views.map((v) => {
            const canGrant = v.journey === "failed" && !v.hasGrant;
            return (
              <Panel
                key={v.badge.id}
                title={v.badge.name}
                description={`${v.progress.clearedCount} of ${v.progress.requiredCount} skills cleared${v.eligibleAt ? ` · eligible since ${fmtStamp(v.eligibleAt)}` : ""}`}
                action={<JourneyPill state={v.journey} />}
                data-testid={`team-badge-${v.badge.slug}`}
              >
                {v.journey === "locked" ? (
                  <p className="text-sm text-muted-foreground">
                    Not eligible yet. Still to clear: {v.skills.filter((s) => !s.clearedAt).map((s) => s.name).join(", ")}.
                  </p>
                ) : (
                  <>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Next action: </span>
                      <span className="font-medium">
                        {v.journey === "failed" && v.hasGrant ? "New attempt opened - student to book" : NEXT_ACTION[v.journey]}
                      </span>
                    </p>
                    {v.award && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Badge awarded {fmtStamp(v.award.awardedAt)}
                        {v.nullifiedAt && ` · nullified ${fmtStamp(v.nullifiedAt)}`}
                      </p>
                    )}
                    {v.attempts.length > 0 && (
                      <ol className="mt-4 space-y-3">
                        {v.attempts.map((a) => (
                          <li key={a.id} className="rounded-lg border">
                            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3.5 py-2">
                              <span className="text-sm font-semibold">Attempt {a.attemptNo}</span>
                              <AttemptPill status={a.status} />
                            </div>
                            <ul className="divide-y">
                              {a.appointments.map((p) => (
                                <li key={p.id}>
                                  <Link
                                    href={`/team/appointments/${p.id}`}
                                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-sm hover:bg-muted/50"
                                  >
                                    <span>
                                      {fmtDate(p.startsAt)} · {fmtRange(p.startsAt, p.endsAt)}
                                      <span className="text-muted-foreground"> · {p.interviewerName}</span>
                                    </span>
                                    <PhasePill phase={appointmentPhase(p, now)} />
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ol>
                    )}
                    {(canGrant || v.award?.status === "active") && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                        {canGrant && (
                          <ActionButton
                            action={grantReattemptAction.bind(null, student.id, v.badge.id)}
                            variant="outline"
                            size="sm"
                            testId="grant-reattempt"
                            confirm={{
                              title: `Open a new attempt for ${student.name}?`,
                              description:
                                "After a failed interview a student cannot re-book on their own. This allows exactly one new booking. The failed attempt stays in the history.",
                              confirmLabel: "Open new attempt",
                              reason: { label: "Reason", placeholder: "e.g. completed the recommended revision", minLength: POLICY.minReasonLength },
                            }}
                          >
                            Open a new attempt
                          </ActionButton>
                        )}
                        {v.award?.status === "active" && (
                          <NullifyButton awardId={v.award.id} studentName={student.name} badgeName={v.badge.name} />
                        )}
                      </div>
                    )}
                  </>
                )}
              </Panel>
            );
          })}
        </div>
        <Panel title="Activity history" description="Every recorded event for this student, newest first.">
          <Timeline events={events} empty="No activity recorded for this student yet." />
        </Panel>
      </div>
    </div>
  );
}
