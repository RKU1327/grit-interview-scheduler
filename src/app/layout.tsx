import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { asc } from "drizzle-orm";
import { DemoBar } from "@/components/app/demo-bar";
import { NavLinks } from "@/components/app/nav-links";
import { Toaster } from "@/components/ui/sonner";
import { getDb } from "@/db";
import { interviewers, students } from "@/db/schema";
import { getClockOffsetMs, getNow } from "@/domain/core";
import { getPersona, ROLE_HOME, type Role } from "@/lib/persona";
import { fmtStamp, TZ_LABEL } from "@/lib/time";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "GRIT Interview Scheduler", template: "%s · GRIT Interview Scheduler" },
  description:
    "Prototype interview scheduling workflow for Track Badge interviews: student booking, interviewer availability and outcomes, and interview-team oversight.",
};

const NAV: Record<Role, { href: string; label: string; exact?: boolean }[]> = {
  student: [
    { href: "/student", label: "Home", exact: true },
    { href: "/student/interviews", label: "My interviews" },
    { href: "/student/preview", label: "Before / after" },
  ],
  interviewer: [
    { href: "/interviewer", label: "Schedule", exact: true },
    { href: "/interviewer/availability", label: "Availability" },
  ],
  team: [
    { href: "/team", label: "Overview", exact: true },
    { href: "/team/roster", label: "Eligible students" },
    { href: "/team/appointments", label: "Appointments" },
    { href: "/team/badges", label: "Badges" },
    { href: "/team/activity", label: "Activity" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const persona = await getPersona();
  const db = getDb();
  const offset = getClockOffsetMs(db);
  const who =
    persona.role === "student"
      ? persona.student.name
      : persona.role === "interviewer"
        ? persona.interviewer.name
        : "Interview Team";

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>
        <DemoBar
          role={persona.role}
          studentId={persona.student.id}
          interviewerId={persona.interviewer.id}
          students={db.select({ id: students.id, name: students.name }).from(students).orderBy(asc(students.name)).all()}
          interviewers={db
            .select({ id: interviewers.id, name: interviewers.name })
            .from(interviewers)
            .orderBy(asc(interviewers.name))
            .all()}
          clockLabel={Math.abs(offset) > 1000 ? fmtStamp(getNow(db)) : null}
        />
        <header className="border-b bg-card">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex items-center justify-between gap-4 pt-3.5 pb-1">
              <Link href={ROLE_HOME[persona.role]} className="flex items-center gap-2.5 rounded-md">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-lg bg-primary text-[0.7rem] font-bold tracking-wider text-primary-foreground"
                >
                  GR
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold tracking-tight text-navy">GRIT Interview Scheduler</span>
                  <span className="block text-[0.7rem] text-muted-foreground">Track Badge interviews · prototype</span>
                </span>
              </Link>
              <div className="text-right text-xs leading-tight">
                <p className="font-medium" data-testid="current-user">
                  {who}
                </p>
                <p className="text-muted-foreground">All times in {TZ_LABEL}</p>
              </div>
            </div>
            <NavLinks items={NAV[persona.role]} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="border-t bg-card">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
            <p>Assignment prototype with fictional demo data. Not an official NIAT application.</p>
            <p>Times shown in India Standard Time (Asia/Kolkata, UTC+05:30) · stored in UTC</p>
          </div>
        </footer>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
