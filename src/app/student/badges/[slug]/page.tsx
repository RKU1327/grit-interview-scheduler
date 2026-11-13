import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { BadgeDetail } from "@/components/student/badge-detail";
import { getDb } from "@/db";
import { trackBadges } from "@/db/schema";
import { getNow } from "@/domain/core";
import { getStudentBadgeView } from "@/domain/queries";
import { getPersona } from "@/lib/persona";

export const metadata: Metadata = { title: "Badge" };

export default async function BadgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { student } = await getPersona();
  const db = (await getDb());
  const badge = (await db.select().from(trackBadges).where(eq(trackBadges.slug, slug)).get());
  if (!badge) notFound();
  const now = (await getNow(db));
  const view = (await getStudentBadgeView(db, student.id, badge.id, now))!;
  return (
    <>
      <AutoRefresh seconds={30} />
      <BadgeDetail view={view} student={student} now={now} />
    </>
  );
}
