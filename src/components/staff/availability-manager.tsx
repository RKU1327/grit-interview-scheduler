"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { CalendarPlus, Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { createWindowAction, deleteWindowAction, updateWindowAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export type WindowRow = {
  id: string;
  day: string;
  dayLabel: string;
  startHm: string;
  endHm: string;
  rangeLabel: string;
  slots: number;
  booked: number;
  inProgress: boolean;
};

type Conflict = { appointmentId: string; studentName: string; badgeName: string; startsAt: string; endsAt: string };
type Draft = { day: string; startHm: string; endHm: string };
type PendingChange = { kind: "update"; row: WindowRow; draft: Draft } | { kind: "delete"; row: WindowRow };

const inputCls =
  "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

function timeOptions(slotMinutes: number) {
  const out: string[] = [];
  for (let m = 7 * 60; m <= 21 * 60; m += slotMinutes)
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}
const label12 = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const istTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

function WindowFields({
  draft,
  onChange,
  options,
  min,
  max,
  idPrefix,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  options: string[];
  min: string;
  max: string;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-day`}>Date</Label>
        <input
          id={`${idPrefix}-day`}
          type="date"
          className={inputCls}
          value={draft.day}
          min={min}
          max={max}
          required
          onChange={(e) => onChange({ ...draft, day: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-start`}>From (IST)</Label>
        <select id={`${idPrefix}-start`} className={inputCls} value={draft.startHm} onChange={(e) => onChange({ ...draft, startHm: e.target.value })}>
          {options.slice(0, -1).map((o) => (
            <option key={o} value={o}>
              {label12(o)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-end`}>To (IST)</Label>
        <select id={`${idPrefix}-end`} className={inputCls} value={draft.endHm} onChange={(e) => onChange({ ...draft, endHm: e.target.value })}>
          {options.slice(1).map((o) => (
            <option key={o} value={o}>
              {label12(o)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function AvailabilityManager({
  rows,
  today,
  maxDay,
  slotMinutes,
}: {
  rows: WindowRow[];
  today: string;
  maxDay: string;
  slotMinutes: number;
}) {
  const router = useRouter();
  const options = useMemo(() => timeOptions(slotMinutes), [slotMinutes]);
  const [draft, setDraft] = useState<Draft>({ day: today, startHm: "10:00", endHm: "12:00" });
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: WindowRow; draft: Draft } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<WindowRow | null>(null);
  const [conflict, setConflict] = useState<{ change: PendingChange; conflicts: Conflict[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const addId = useId();
  const editId = useId();

  const slotsIn = (d: Draft) => {
    const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
    return Math.floor((toMin(d.endHm) - toMin(d.startHm)) / slotMinutes);
  };

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: WindowRow[] }>();
    for (const r of rows) {
      if (!map.has(r.day)) map.set(r.day, { label: r.dayLabel, rows: [] });
      map.get(r.day)!.rows.push(r);
    }
    return [...map.entries()];
  }, [rows]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await createWindowAction(draft);
      if (r.ok) {
        toast.success(r.message);
        setFormError(null);
      } else {
        setFormError(r.message);
        toast.error(r.message);
      }
      router.refresh();
    });
  };

  /** Apply an edit/removal. A BOOKING_CONFLICT is never resolved silently: it opens the conflict dialog. */
  const apply = (change: PendingChange, resolution?: "release") =>
    startTransition(async () => {
      const r: ActionResult<{ released: number }> =
        change.kind === "update"
          ? await updateWindowAction(change.row.id, change.draft, resolution)
          : await deleteWindowAction(change.row.id, resolution);
      if (r.ok) {
        toast.success(r.message);
        setEditing(null);
        setRemoving(null);
        setConflict(null);
        setEditError(null);
      } else if (r.code === "BOOKING_CONFLICT") {
        setEditing(null);
        setRemoving(null);
        setConflict({ change, conflicts: (r.details as { conflicts: Conflict[] }).conflicts });
      } else {
        if (change.kind === "update") setEditError(r.message);
        else setRemoving(null);
        toast.error(r.message);
      }
      router.refresh();
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="rounded-xl border bg-card shadow-xs lg:order-2 lg:self-start">
        <header className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight">Add availability</h2>
        </header>
        <form onSubmit={add} className="space-y-4 p-5" data-testid="add-window-form">
          <WindowFields draft={draft} onChange={setDraft} options={options} min={today} max={maxDay} idPrefix={addId} />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {slotsIn(draft) > 0
              ? `Creates ${slotsIn(draft)} bookable ${slotMinutes}-minute slot${slotsIn(draft) === 1 ? "" : "s"}.`
              : "The end time must be after the start time."}
          </p>
          {formError && (
            <p role="alert" data-testid="window-error" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200 ring-inset">
              {formError}
            </p>
          )}
          <Button type="submit" disabled={pending || slotsIn(draft) <= 0} data-testid="add-window">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarPlus aria-hidden />} Add availability
          </Button>
        </form>
      </section>

      <section className="rounded-xl border bg-card shadow-xs">
        <header className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight">Upcoming availability</h2>
          <p className="mt-0.5 text-[0.8rem] text-muted-foreground">
            Next three weeks. Windows with booked interviews are protected: changing them asks you what to do.
          </p>
        </header>
        {groups.length === 0 ? (
          <div className="p-5">
            <div className="rounded-lg border border-dashed bg-muted/40 px-6 py-9 text-center">
              <p className="text-sm font-medium">No availability offered yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a window and eligible students will be able to book interviews with you.
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y" data-testid="window-list">
            {groups.map(([day, g]) => (
              <li key={day} className="px-5 py-3.5">
                <p className="mb-2 text-sm font-medium">{g.label}</p>
                <ul className="space-y-2">
                  {g.rows.map((r) => (
                    <li
                      key={r.id}
                      data-testid="window-row"
                      data-day={r.day}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2"
                    >
                      <div className="text-sm">
                        <span className="font-semibold tabular-nums">{r.rangeLabel}</span>
                        <span className="ml-2 text-muted-foreground">
                          {r.slots} slot{r.slots === 1 ? "" : "s"} ·{" "}
                          <span className={r.booked > 0 ? "font-medium text-primary" : undefined}>{r.booked} booked</span>
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditError(null);
                            setEditing({ row: r, draft: { day: r.day, startHm: r.startHm, endHm: r.endHm } });
                          }}
                          aria-label={`Edit ${r.rangeLabel} on ${r.dayLabel}`}
                          data-testid="edit-window"
                        >
                          <Pencil aria-hidden /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() => setRemoving(r)}
                          aria-label={`Remove ${r.rangeLabel} on ${r.dayLabel}`}
                          data-testid="remove-window"
                        >
                          <Trash2 aria-hidden /> Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && !pending && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit availability</DialogTitle>
            <DialogDescription>
              {editing?.row.booked
                ? `${editing.row.booked} interview${editing.row.booked === 1 ? " is" : "s are"} booked in this window. If your change leaves any of them uncovered you will be asked how to resolve it.`
                : "No interviews are booked in this window yet."}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <WindowFields
              draft={editing.draft}
              onChange={(d) => setEditing({ ...editing, draft: d })}
              options={options}
              min={today}
              max={maxDay}
              idPrefix={editId}
            />
          )}
          {editError && (
            <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200 ring-inset">
              {editError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !editing || slotsIn(editing.draft) <= 0}
              onClick={() => editing && apply({ kind: "update", row: editing.row, draft: editing.draft })}
              data-testid="save-window"
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && !pending && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this availability?</DialogTitle>
            <DialogDescription>
              {removing?.dayLabel}, {removing?.rangeLabel}. Students will no longer be able to book these slots.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={pending}>
              Keep it
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={pending}
              onClick={() => removing && apply({ kind: "delete", row: removing })}
              data-testid="confirm-remove-window"
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />} Remove availability
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conflict !== null} onOpenChange={(o) => !o && !pending && setConflict(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="conflict-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-amber-600" aria-hidden />
              This change affects booked interviews
            </DialogTitle>
            <DialogDescription>
              Nothing has been changed yet. {conflict?.conflicts.length === 1 ? "This interview" : "These interviews"} would be left
              without availability:
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-lg border text-sm">
            {conflict?.conflicts.map((c) => (
              <li key={c.appointmentId} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span className="font-medium">{c.studentName}</span>
                <span className="text-muted-foreground">
                  {c.badgeName} · {istTime(c.startsAt)} – {istTime(c.endsAt)} IST
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            You can keep your availability as it is, or release these interviews: each one is cancelled on your behalf, the student is told
            the interviewer is no longer available and can re-book with no penalty.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)} disabled={pending} data-testid="conflict-keep">
              Keep my availability
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={pending}
              onClick={() => conflict && apply(conflict.change, "release")}
              data-testid="conflict-release"
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Release {conflict?.conflicts.length === 1 ? "interview" : `${conflict?.conflicts.length} interviews`} and apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
