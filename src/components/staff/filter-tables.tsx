"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";
import { JOURNEY_META, OutcomePill, PHASE_META } from "@/components/app/status";
import { Pill, tableCls } from "@/components/app/ui";
import type { Outcome } from "@/db/schema";
import type { JourneyState } from "@/domain/policy";
import type { AppointmentPhase } from "@/domain/queries";
import { cn } from "@/lib/utils";

const inputCls =
  "h-9 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

/** Keeps a filter in the URL so views can be linked to (e.g. from the overview tiles). */
function useUrlParam(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(key) ?? "";
  const set = (next: string) => {
    const sp = new URLSearchParams(params.toString());
    if (next) sp.set(key, next);
    else sp.delete(key);
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };
  return [value, set] as const;
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <SearchX className="mb-2 size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">No rows match these filters</p>
      <button type="button" onClick={onClear} className="mt-1 rounded text-sm font-medium text-primary hover:underline">
        Clear filters
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- roster

export type RosterViewRow = {
  key: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  badgeName: string;
  eligibleLabel: string;
  journey: JourneyState;
  bookingLabel: string;
  bookingHref: string | null;
  attemptCount: number;
  nextAction: string;
};

const BOOKING_FILTERS: { value: string; label: string; match: (j: JourneyState) => boolean }[] = [
  { value: "", label: "All", match: () => true },
  { value: "eligible_unbooked", label: "Not booked", match: (j) => j === "eligible_unbooked" },
  { value: "booked", label: "Booked", match: (j) => j === "booked" },
  { value: "awaiting_outcome", label: "Outcome pending", match: (j) => j === "awaiting_outcome" },
  { value: "passed", label: "Passed", match: (j) => j === "passed" },
  { value: "failed", label: "Failed", match: (j) => j === "failed" },
  { value: "retake_later", label: "Retake later", match: (j) => j === "retake_later" },
  { value: "nullified", label: "Nullified", match: (j) => j === "nullified" },
];

export function RosterTable({ rows, badges }: { rows: RosterViewRow[]; badges: string[] }) {
  const [state, setState] = useUrlParam("state");
  const [q, setQ] = useState("");
  const [badge, setBadge] = useState("");
  const filter = BOOKING_FILTERS.find((f) => f.value === state) ?? BOOKING_FILTERS[0];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        filter.match(r.journey) &&
        (!badge || r.badgeName === badge) &&
        (!needle || `${r.studentName} ${r.studentEmail} ${r.badgeName}`.toLowerCase().includes(needle)),
    );
  }, [rows, filter, badge, q]);
  const counts = useMemo(
    () => Object.fromEntries(BOOKING_FILTERS.map((f) => [f.value, rows.filter((r) => f.match(r.journey)).length])),
    [rows],
  );

  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by booking state">
          {BOOKING_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setState(f.value)}
              aria-pressed={filter.value === f.value}
              data-testid={`roster-filter-${f.value || "all"}`}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter.value === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50",
              )}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search student, email or badge"
              aria-label="Search roster"
              data-testid="roster-search"
              className={cn(inputCls, "w-full pl-8")}
            />
          </div>
          <select value={badge} onChange={(e) => setBadge(e.target.value)} aria-label="Filter by badge" className={inputCls}>
            <option value="">All badges</option>
            {badges.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>
      {shown.length === 0 ? (
        <NoMatches
          onClear={() => {
            setState("");
            setQ("");
            setBadge("");
          }}
        />
      ) : (
        <div className={tableCls.wrap}>
          <table className={tableCls.table} data-testid="roster-table">
            <caption className="sr-only">Eligible students and their booking state</caption>
            <thead>
              <tr>
                {["Student", "Badge", "Eligible since", "Booking state", "Interview", "Next action"].map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const m = JOURNEY_META[r.journey];
                return (
                  <tr key={r.key} data-testid="roster-row" data-student={r.studentId} data-journey={r.journey}>
                    <td className={tableCls.td}>
                      <Link href={`/team/students/${r.studentId}`} className="rounded font-medium hover:text-primary hover:underline">
                        {r.studentName}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{r.studentEmail}</span>
                    </td>
                    <td className={tableCls.td}>{r.badgeName}</td>
                    <td className={cn(tableCls.td, "whitespace-nowrap text-muted-foreground")}>{r.eligibleLabel}</td>
                    <td className={tableCls.td}>
                      <Pill tone={m.tone}>
                        {m.icon}
                        {m.short}
                      </Pill>
                      {r.attemptCount > 1 && <span className="mt-1 block text-xs text-muted-foreground">{r.attemptCount} attempts</span>}
                    </td>
                    <td className={cn(tableCls.td, "whitespace-nowrap")}>
                      {r.bookingHref ? (
                        <Link href={r.bookingHref} className="rounded text-primary hover:underline">
                          {r.bookingLabel}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{r.bookingLabel}</span>
                      )}
                    </td>
                    <td className={tableCls.td}>{r.nextAction}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground" aria-live="polite">
        Showing {shown.length} of {rows.length} eligible student–badge records
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- appointments

export type AppointmentViewRow = {
  id: string;
  whenLabel: string;
  timeLabel: string;
  studentName: string;
  studentId: string;
  badgeName: string;
  interviewerId: string;
  interviewerName: string;
  attemptNo: number;
  phase: AppointmentPhase;
  outcome: Outcome | null;
  isPast: boolean;
};

const PHASE_FILTERS: { value: string; label: string; match: (r: AppointmentViewRow) => boolean }[] = [
  { value: "", label: "All", match: () => true },
  { value: "scheduled", label: "Scheduled", match: (r) => r.phase === "scheduled" || r.phase === "in_progress" },
  { value: "outcome_pending", label: "Outcome pending", match: (r) => r.phase === "outcome_pending" },
  { value: "completed", label: "Completed", match: (r) => r.phase === "completed" },
  { value: "cancelled", label: "Cancelled", match: (r) => r.phase === "cancelled" },
  { value: "rescheduled", label: "Rescheduled", match: (r) => r.phase === "rescheduled" },
  { value: "no_show", label: "No-show / absent", match: (r) => r.phase === "no_show" || r.phase === "interviewer_absent" },
];

export function AppointmentsTable({
  rows,
  interviewers,
}: {
  rows: AppointmentViewRow[];
  interviewers: { id: string; name: string }[];
}) {
  const [status, setStatus] = useUrlParam("status");
  const [interviewer, setInterviewer] = useState("");
  const [q, setQ] = useState("");
  const filter = PHASE_FILTERS.find((f) => f.value === status) ?? PHASE_FILTERS[0];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        filter.match(r) &&
        (!interviewer || r.interviewerId === interviewer) &&
        (!needle || `${r.studentName} ${r.badgeName}`.toLowerCase().includes(needle)),
    );
  }, [rows, filter, interviewer, q]);

  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {PHASE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={filter.value === f.value}
              data-testid={`appt-filter-${f.value || "all"}`}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter.value === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50",
              )}
            >
              {f.label} <span className="tabular-nums opacity-70">{rows.filter(f.match).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search student or badge"
              aria-label="Search appointments"
              className={cn(inputCls, "w-full pl-8")}
            />
          </div>
          <select
            value={interviewer}
            onChange={(e) => setInterviewer(e.target.value)}
            aria-label="Filter by interviewer"
            data-testid="appt-interviewer-filter"
            className={inputCls}
          >
            <option value="">All interviewers</option>
            {interviewers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {shown.length === 0 ? (
        <NoMatches
          onClear={() => {
            setStatus("");
            setQ("");
            setInterviewer("");
          }}
        />
      ) : (
        <div className={tableCls.wrap}>
          <table className={tableCls.table} data-testid="appointments-table">
            <caption className="sr-only">All interview appointments</caption>
            <thead>
              <tr>
                {["When (IST)", "Student", "Badge", "Interviewer", "Status", "Outcome", ""].map((h, i) => (
                  <th key={i} scope="col" className={tableCls.th}>
                    {h || <span className="sr-only">Open</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const m = PHASE_META[r.phase];
                return (
                  <tr key={r.id} data-testid="appointment-row" data-student={r.studentId}>
                    <td className={cn(tableCls.td, "whitespace-nowrap")}>
                      <span className="font-medium">{r.whenLabel}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">{r.timeLabel}</span>
                    </td>
                    <td className={tableCls.td}>
                      <Link href={`/team/students/${r.studentId}`} className="rounded hover:text-primary hover:underline">
                        {r.studentName}
                      </Link>
                    </td>
                    <td className={tableCls.td}>
                      {r.badgeName}
                      <span className="block text-xs text-muted-foreground">Attempt {r.attemptNo}</span>
                    </td>
                    <td className={tableCls.td}>{r.interviewerName}</td>
                    <td className={tableCls.td}>
                      <Pill tone={m.tone}>
                        {m.icon}
                        {m.label}
                      </Pill>
                    </td>
                    <td className={tableCls.td}>{r.outcome ? <OutcomePill outcome={r.outcome} /> : <span className="text-muted-foreground">–</span>}</td>
                    <td className={cn(tableCls.td, "text-right")}>
                      <Link href={`/team/appointments/${r.id}`} className="rounded text-sm font-medium text-primary hover:underline">
                        {r.phase === "outcome_pending" ? "Record" : "Open"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground" aria-live="polite">
        Showing {shown.length} of {rows.length} appointments
      </p>
    </div>
  );
}
