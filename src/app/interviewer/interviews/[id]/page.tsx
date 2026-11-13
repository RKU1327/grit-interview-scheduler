import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { InterviewDetail } from "@/components/staff/interview-detail";
import { getDb } from "@/db";
import { getNow } from "@/domain/core";
import { getAppointmentDetail } from "@/domain/queries";
import { getPersona } from "@/lib/persona";
import { dayKey } from "@/lib/time";

export const metadata: Metadata = { title: "Interview" };

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { interviewer } = await getPersona();
  const db = (await getDb());
  const detail = (await getAppointmentDetail(db, id));
  // An interviewer can only open interviews assigned to them.
  if (!detail || detail.appt.interviewerId !== interviewer.id) notFound();
  return (
    <>
      <AutoRefresh seconds={30} />
      <InterviewDetail
        db={db}
        detail={detail}
        role="interviewer"
        now={(await getNow(db))}
        back={{ href: `/interviewer?date=${dayKey(detail.appt.startsAt)}`, label: "Schedule" }}
      />
    </>
  );
}
