"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { CircleCheck, CircleX, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { correctOutcomeAction, recordOutcomeAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Outcome } from "@/db/schema";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Outcome; label: string; hint: string; icon: React.ReactNode; active: string }[] = [
  {
    value: "pass",
    label: "Pass",
    hint: "Awards the Track Badge immediately.",
    icon: <CircleCheck aria-hidden />,
    active: "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200",
  },
  {
    value: "fail",
    label: "Fail",
    hint: "No badge. A new attempt needs the interview team.",
    icon: <CircleX aria-hidden />,
    active: "border-rose-500 bg-rose-50 ring-2 ring-rose-200",
  },
  {
    value: "retake_later",
    label: "Retake later",
    hint: "No decision. The student re-books after a wait.",
    icon: <RotateCcw aria-hidden />,
    active: "border-violet-500 bg-violet-50 ring-2 ring-violet-200",
  },
];

/**
 * Records an outcome (mode "record") or issues an authorised correction
 * (mode "correct", interview team only). Both go through a confirmation step
 * because the result is published to the student straight away.
 */
export function OutcomeForm({
  mode,
  appointmentId,
  attemptId,
  studentName,
  allowed = ["pass", "fail", "retake_later"],
  retakeWaitOptions,
  defaultRetakeWait,
}: {
  mode: "record" | "correct";
  appointmentId: string;
  attemptId: string;
  studentName: string;
  allowed?: Outcome[];
  retakeWaitOptions: readonly number[];
  defaultRetakeWait: number;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState("");
  const [wait, setWait] = useState(defaultRetakeWait);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const groupId = useId();
  const notesId = useId();
  const waitId = useId();
  const correcting = mode === "correct";
  const reasonOk = !correcting || notes.trim().length >= 10;
  const chosen = OPTIONS.find((o) => o.value === outcome);

  const submit = () =>
    startTransition(async () => {
      if (!outcome) return;
      const result = correcting
        ? await correctOutcomeAction({ attemptId, outcome, reason: notes })
        : await recordOutcomeAction({ appointmentId, outcome, privateNotes: notes, retakeWaitDays: wait });
      setOpen(false);
      if (result.ok) {
        toast.success(result.message);
        setError(null);
        setNotes("");
        setOutcome(null);
      } else {
        setError(result.message);
        toast.error(result.message);
      }
      router.refresh();
    });

  return (
    <form
      className="space-y-4"
      data-testid={correcting ? "correction-form" : "outcome-form"}
      onSubmit={(e) => {
        e.preventDefault();
        if (outcome && reasonOk) setOpen(true);
      }}
    >
      <fieldset>
        <legend id={groupId} className="mb-2 text-sm font-medium">
          {correcting ? "Corrected outcome" : "Interview outcome"}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby={groupId}>
          {OPTIONS.filter((o) => allowed.includes(o.value)).map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border bg-card p-3 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                outcome === o.value ? o.active : "hover:border-primary/40",
              )}
            >
              <input
                type="radio"
                name={`${groupId}-outcome`}
                value={o.value}
                checked={outcome === o.value}
                onChange={() => setOutcome(o.value)}
                className="sr-only"
                data-testid={`outcome-${o.value}`}
              />
              <span className="flex items-center gap-1.5 font-semibold [&_svg]:size-4">
                {o.icon} {o.label}
              </span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {!correcting && outcome === "retake_later" && (
        <div className="grid gap-1.5">
          <Label htmlFor={waitId}>Student can re-book after</Label>
          <select
            id={waitId}
            value={wait}
            onChange={(e) => setWait(Number(e.target.value))}
            className="h-9 w-full max-w-xs rounded-lg border border-input bg-card px-2.5 text-sm"
          >
            {retakeWaitOptions.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? "No wait - can re-book immediately" : `${d} days`}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Prototype policy. The student is shown the exact date.</p>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={notesId}>{correcting ? "Reason for correction" : "Private notes (optional)"}</Label>
        <Textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={correcting ? "Why is the recorded outcome wrong?" : "Visible to interviewers and the interview team only"}
          data-testid="outcome-notes"
        />
        <p className="text-xs text-muted-foreground">
          {correcting
            ? "Required, at least 10 characters. The original outcome stays in the history."
            : "Never shown to the student."}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200 ring-inset">
          {error}
        </p>
      )}

      <Button type="submit" disabled={!outcome || !reasonOk || pending} data-testid="outcome-submit">
        {correcting ? "Review correction" : "Review and publish"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {correcting ? "Correct" : "Publish"} outcome: {chosen?.label}?
            </DialogTitle>
            <DialogDescription>
              {correcting
                ? `${studentName} will see the corrected result. The original outcome is kept and marked as superseded.`
                : `${studentName} will see this result immediately. Once published, an interviewer cannot change it; only the interview team can issue a correction with a reason.`}
              {outcome === "pass" && " A pass awards the badge."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Go back
            </Button>
            <Button type="button" onClick={submit} disabled={pending} data-testid="outcome-confirm">
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {correcting ? "Confirm correction" : `Publish ${chosen?.label ?? ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
