"use client";

import Link from "next/link";
import { useTransition } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { switchPersonaAction } from "@/app/actions";
import { cn } from "@/lib/utils";

type Person = { id: string; name: string };

/**
 * Persistent demo persona switcher. Always visible, clearly labelled, and the
 * only "login" the prototype has.
 */
export function DemoBar({
  role,
  studentId,
  interviewerId,
  students,
  interviewers,
  clockLabel,
}: {
  role: "student" | "interviewer" | "team";
  studentId: string;
  interviewerId: string;
  students: Person[];
  interviewers: Person[];
  clockLabel: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const go = (nextRole: string, personId?: string) => startTransition(() => switchPersonaAction(nextRole, personId));
  const roles = [
    ["student", "Student"],
    ["interviewer", "Interviewer"],
    ["team", "Interview Team"],
  ] as const;
  const selectCls =
    "h-7 max-w-[10rem] rounded-md border border-white/20 bg-white/10 px-1.5 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60 [&>option]:text-slate-900";

  return (
    <div className="bg-navy text-white" role="region" aria-label="Demo mode controls">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-2 py-0.5 font-semibold text-slate-900">
          <FlaskConical className="size-3" aria-hidden /> Demo mode
        </span>
        <span className="hidden text-white/70 md:inline">Fictional data · no sign-in</span>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-white/70" id="persona-label">
            Viewing as
          </span>
          <div className="inline-flex rounded-md bg-white/10 p-0.5" role="group" aria-labelledby="persona-label">
            {roles.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => go(value)}
                aria-pressed={role === value}
                data-testid={`persona-${value}`}
                disabled={pending}
                className={cn(
                  "rounded px-2 py-1 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                  role === value ? "bg-white text-navy shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {role === "student" && (
            <select
              aria-label="Choose demo student"
              data-testid="persona-student-select"
              className={selectCls}
              value={studentId}
              disabled={pending}
              onChange={(e) => go("student", e.target.value)}
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {role === "interviewer" && (
            <select
              aria-label="Choose demo interviewer"
              data-testid="persona-interviewer-select"
              className={selectCls}
              value={interviewerId}
              disabled={pending}
              onChange={(e) => go("interviewer", e.target.value)}
            >
              {interviewers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {pending && <Loader2 className="size-3.5 animate-spin" aria-label="Switching persona" />}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {clockLabel && (
            <span className="rounded bg-amber-300/20 px-1.5 py-0.5 text-amber-200" data-testid="demo-clock">
              Demo clock: {clockLabel}
            </span>
          )}
          <Link href="/demo" className="font-medium underline-offset-2 hover:underline">
            Guided demo
          </Link>
        </div>
      </div>
    </div>
  );
}
