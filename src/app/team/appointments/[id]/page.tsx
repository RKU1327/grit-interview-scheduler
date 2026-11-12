import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InterviewDetail } from "@/components/staff/interview-detail";
import { getDb } from "@/db";
import { getNow } from "@/domain/core";
import { getAppointmentDetail } from "@/domain/queries";

export const metadata: Metadata = { title: "Appointment" };

export default async function TeamAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const detail = getAppointmentDetail(db, id);
  if (!detail) notFound();
  return (
    <InterviewDetail
      db={db}
      detail={detail}
      role="team"
      now={getNow(db)}
      back={{ href: "/team/appointments", label: "Appointments" }}
    />
  );
}
