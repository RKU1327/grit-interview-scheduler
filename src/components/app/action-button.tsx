"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";

export type ConfirmSpec = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Ask for a free-text reason that is passed to the action. */
  reason?: { label: string; placeholder?: string; minLength?: number; help?: string };
  /** Extra acknowledgement checkbox the user must tick. */
  acknowledge?: string;
};

/**
 * Runs a server action with pending state, toast feedback and an optional
 * confirmation dialog. While pending the button is disabled, so a double
 * click cannot submit twice (the server is idempotent as a second line of defence).
 */
export function ActionButton({
  action,
  children,
  variant = "default",
  size = "default",
  className,
  confirm,
  redirectTo,
  disabled,
  testId,
}: {
  action: (reason: string) => Promise<ActionResult<unknown>>;
  children: ReactNode;
  variant?: Variant;
  size?: "default" | "sm" | "lg" | "xs";
  className?: string;
  confirm?: ConfirmSpec;
  redirectTo?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const ackId = useId();

  const minLength = confirm?.reason?.minLength ?? 0;
  const reasonOk = !confirm?.reason || reason.trim().length >= minLength;
  const ackOk = !confirm?.acknowledge || ack;

  const submit = () =>
    startTransition(async () => {
      const result = await action(reason.trim());
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
        setReason("");
        setAck(false);
        setError(null);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        setError(result.message);
        toast.error(result.message);
        router.refresh();
      }
    });

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || pending}
        data-testid={testId}
        onClick={() => (confirm ? setOpen(true) : submit())}
      >
        {pending && !confirm && <Loader2 className="animate-spin" aria-hidden />}
        {children}
      </Button>
      {confirm && (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!pending) {
              setOpen(next);
              if (!next) setError(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription render={<div />}>{confirm.description}</DialogDescription>
            </DialogHeader>
            {confirm.reason && (
              <div className="grid gap-1.5">
                <Label htmlFor={reasonId}>{confirm.reason.label}</Label>
                <Textarea
                  id={reasonId}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={confirm.reason.placeholder}
                  rows={3}
                  aria-describedby={`${reasonId}-help`}
                />
                <p id={`${reasonId}-help`} className="text-xs text-muted-foreground">
                  {confirm.reason.help ??
                    (minLength > 0 ? `Required, at least ${minLength} characters. Stored in the audit trail.` : "Optional.")}
                </p>
              </div>
            )}
            {confirm.acknowledge && (
              <label htmlFor={ackId} className="flex items-start gap-2.5 rounded-lg border bg-muted/50 p-3 text-sm">
                <input
                  id={ackId}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                <span>{confirm.acknowledge}</span>
              </label>
            )}
            {error && (
              <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200 ring-inset">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Go back
              </Button>
              <Button
                variant={confirm.destructive ? "destructive" : "default"}
                className={confirm.destructive ? "bg-rose-600 text-white hover:bg-rose-700" : undefined}
                onClick={submit}
                disabled={pending || !reasonOk || !ackOk}
                data-testid={testId ? `${testId}-confirm` : undefined}
              >
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {confirm.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
