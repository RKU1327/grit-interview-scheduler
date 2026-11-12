"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Globe, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { bookAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PickerSlot = {
  interviewerId: string;
  interviewerName: string;
  startsAt: string;
  endsAt: string;
  /** Pre-formatted on the server in IST so client and server can never disagree. */
  timeLabel: string;
  endLabel: string;
  period: "Morning" | "Afternoon" | "Evening";
};
export type PickerDay = { key: string; weekday: string; dayNum: string; month: string; longLabel: string; slots: PickerSlot[] };

const slotKey = (s: PickerSlot) => `${s.interviewerId}|${s.startsAt}`;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

export function SlotPicker({
  badgeId,
  badgeName,
  badgeSlug,
  days,
  rescheduleOf,
  currentSlotLabel,
}: {
  badgeId: string;
  badgeName: string;
  badgeSlug: string;
  days: PickerDay[];
  rescheduleOf?: string;
  currentSlotLabel?: string;
}) {
  const router = useRouter();
  const firstWithSlots = days.find((d) => d.slots.length > 0)?.key ?? days[0]?.key;
  const [dayKey, setDayKey] = useState(firstWithSlots);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  // One idempotency key per selected slot: a double click or a retried
  // request for the same choice can never create two bookings.
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const dayIndex = Math.max(0, days.findIndex((d) => d.key === dayKey));
  const day = days[dayIndex];
  // The selection is looked up in fresh server data on every render, so a
  // slot that disappears while the student is viewing it deselects itself.
  const selected = useMemo(
    () => days.flatMap((d) => d.slots).find((s) => slotKey(s) === selectedKey) ?? null,
    [days, selectedKey],
  );
  const selectedDay = selected ? days.find((d) => d.slots.includes(selected)) : null;
  const vanished = selectedKey !== null && selected === null;

  const pick = (s: PickerSlot) => {
    setSelectedKey(slotKey(s));
    setError(null);
    setIdempotencyKey(newKey());
  };

  const confirm = () =>
    startTransition(async () => {
      if (!selected) return;
      const result = await bookAction({
        badgeId,
        interviewerId: selected.interviewerId,
        startsAt: selected.startsAt,
        idempotencyKey,
        rescheduleOf,
      });
      if (result.ok) {
        toast.success(result.message);
        router.push(`/student/badges/${badgeSlug}`);
        router.refresh();
      } else {
        setConfirmOpen(false);
        setError(result.message);
        setSelectedKey(null);
        toast.error(result.message);
        router.refresh(); // pull the latest availability
      }
    });

  const periods = ["Morning", "Afternoon", "Evening"] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-accent/60 px-4 py-2.5 text-sm">
        <p className="inline-flex items-center gap-2 font-medium text-navy" data-testid="tz-notice">
          <Globe className="size-4 text-primary" aria-hidden />
          Times are shown in India Standard Time (IST, UTC+05:30)
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          aria-label="Refresh available slots"
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden /> Refresh slots
        </Button>
      </div>

      {(error || vanished) && (
        <div role="alert" data-testid="slot-error" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error ?? "The slot you selected is no longer available. The list below is up to date - please choose another time."}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold" id="date-heading">
            1. Choose a date
          </h2>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous day"
              disabled={dayIndex === 0}
              onClick={() => setDayKey(days[dayIndex - 1].key)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next day"
              disabled={dayIndex === days.length - 1}
              onClick={() => setDayKey(days[dayIndex + 1].key)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-labelledby="date-heading">
          {days.map((d) => {
            const active = d.key === day?.key;
            const none = d.slots.length === 0;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setDayKey(d.key)}
                aria-pressed={active}
                aria-label={`${d.longLabel}, ${none ? "no slots" : `${d.slots.length} slots available`}`}
                data-testid={`day-${d.key}`}
                className={cn(
                  "flex min-w-[4.25rem] shrink-0 flex-col items-center rounded-lg border px-2 py-2 text-center transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card hover:border-primary/50",
                  none && !active && "text-muted-foreground opacity-70",
                )}
              >
                <span className="text-[0.7rem] font-medium uppercase">{d.weekday}</span>
                <span className="text-lg leading-tight font-semibold tabular-nums">{d.dayNum}</span>
                <span className="text-[0.7rem]">{d.month}</span>
                <span className={cn("mt-1 text-[0.65rem]", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {none ? "No slots" : `${d.slots.length} slot${d.slots.length === 1 ? "" : "s"}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">2. Choose a 30-minute slot{day ? ` on ${day.longLabel}` : ""}</h2>
        {!day || day.slots.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/40 px-6 py-9 text-center">
            <CalendarClock className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No open slots on this day</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Interviewers have no free time here. Try another date - days with availability show a slot count.
            </p>
          </div>
        ) : (
          <div className="space-y-4" data-testid="slot-list">
            {periods.map((period) => {
              const list = day.slots.filter((s) => s.period === period);
              if (list.length === 0) return null;
              return (
                <div key={period}>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{period}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {list.map((s) => {
                      const active = selectedKey === slotKey(s);
                      return (
                        <button
                          key={slotKey(s)}
                          type="button"
                          onClick={() => pick(s)}
                          aria-pressed={active}
                          data-testid="slot"
                          data-start={s.startsAt}
                          data-interviewer={s.interviewerId}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left transition-colors",
                            active ? "border-primary bg-accent ring-2 ring-primary/30" : "bg-card hover:border-primary/50",
                          )}
                        >
                          <span className="block text-sm font-semibold tabular-nums">{s.timeLabel}</span>
                          <span className="block truncate text-xs text-muted-foreground">with {s.interviewerName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-md">
        <p className="text-sm" aria-live="polite">
          {selected && selectedDay ? (
            <>
              <span className="text-muted-foreground">Selected: </span>
              <strong className="font-semibold">
                {selectedDay.longLabel}, {selected.timeLabel} – {selected.endLabel} IST
              </strong>{" "}
              <span className="text-muted-foreground">with {selected.interviewerName}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Select a slot to continue.</span>
          )}
        </p>
        <Button size="lg" disabled={!selected} onClick={() => setConfirmOpen(true)} data-testid="review-booking">
          {rescheduleOf ? "Review new time" : "Review booking"}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => !pending && setConfirmOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rescheduleOf ? "Confirm your new interview time" : "Confirm your interview"}</DialogTitle>
            <DialogDescription>Check the details before you confirm. The slot is only held once you confirm.</DialogDescription>
          </DialogHeader>
          {selected && selectedDay && (
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 rounded-lg border bg-muted/40 p-3.5 text-sm">
              <dt className="text-muted-foreground">Badge</dt>
              <dd className="font-medium">{badgeName}</dd>
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-medium">{selectedDay.longLabel}</dd>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="font-medium">
                {selected.timeLabel} – {selected.endLabel} IST
              </dd>
              <dt className="text-muted-foreground">Time zone</dt>
              <dd className="font-medium">India Standard Time (Asia/Kolkata)</dd>
              <dt className="text-muted-foreground">Interviewer</dt>
              <dd className="font-medium">{selected.interviewerName}</dd>
              {currentSlotLabel && (
                <>
                  <dt className="text-muted-foreground">Replaces</dt>
                  <dd className="font-medium">{currentSlotLabel}</dd>
                </>
              )}
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Choose another slot
            </Button>
            <Button onClick={confirm} disabled={pending} data-testid="confirm-booking">
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {rescheduleOf ? "Confirm reschedule" : "Confirm booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
