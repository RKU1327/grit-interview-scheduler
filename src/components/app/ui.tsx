import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { AuditRow } from "@/domain/queries";
import { fmtStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "violet";

export const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  danger: "bg-rose-50 text-rose-800 ring-rose-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

export const TONE_PANEL: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-50",
  info: "border-indigo-200 bg-indigo-50/60",
  success: "border-emerald-200 bg-emerald-50/60",
  warning: "border-amber-200 bg-amber-50/60",
  danger: "border-rose-200 bg-rose-50/60",
  violet: "border-violet-200 bg-violet-50/60",
};

export const TONE_ICON: Record<Tone, string> = {
  neutral: "bg-slate-200 text-slate-700",
  info: "bg-indigo-100 text-indigo-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-rose-100 text-rose-700",
  violet: "bg-violet-100 text-violet-700",
};

export function Pill({ tone = "neutral", children, className, ...rest }: { tone?: Tone } & ComponentProps<"span">) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset [&_svg]:size-3",
        TONE_PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
} & Omit<ComponentProps<"section">, "title">) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-card shadow-xs", className)} {...rest}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-[0.8rem] text-muted-foreground">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight text-navy">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed bg-muted/40 px-6 py-9 text-center">
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "xs";
};
export function LinkButton({ variant = "default", size = "default", className, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** A highlighted, action-oriented message block. Used for the three key student messages. */
export function Callout({
  tone,
  icon,
  title,
  children,
  actions,
  testId,
  label,
}: {
  tone: Tone;
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
  label?: string;
}) {
  return (
    <div data-testid={testId} role="status" className={cn("rounded-xl border p-4 sm:p-5", TONE_PANEL[tone])}>
      <div className="flex gap-3.5">
        <div
          className={cn("flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px]", TONE_ICON[tone])}
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          {label && <p className="mb-0.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>}
          <p className="text-[0.95rem] leading-snug font-semibold text-navy" data-slot="callout-title">
            {title}
          </p>
          {children && (
            <div className="mt-1.5 text-sm leading-relaxed text-foreground/80" data-slot="callout-body">
              {children}
            </div>
          )}
          {actions && <div className="mt-3.5 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export function DefList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2.5 text-sm", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const ROLE_NAME: Record<string, string> = {
  student: "Student",
  interviewer: "Interviewer",
  team: "Interview team",
  system: "System",
};

/** Audit trail. `showPrivate` controls whether reasons / notes in the detail payload are shown. */
export function Timeline({ events, empty = "No activity yet." }: { events: AuditRow[]; empty?: string }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {events.map((e) => {
        const detail = e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : {};
        const reason = typeof detail.reason === "string" && detail.reason !== "availability_changed" ? detail.reason : null;
        return (
          <li key={e.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-primary/70 ring-4 ring-card" aria-hidden />
            <p className="text-sm font-medium">{e.summary}</p>
            {e.fromState && e.toState && (
              <p className="mt-0.5 font-mono text-[0.7rem] text-muted-foreground">
                {e.entityType}: {e.fromState} → {e.toState}
              </p>
            )}
            {reason && <p className="mt-1 rounded-md bg-muted px-2 py-1 text-[0.8rem] text-foreground/80">Reason: {reason}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {fmtStamp(e.createdAt)} · {ROLE_NAME[e.actorRole]}
              {e.actorRole !== "system" && `: ${e.actorName}`}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export const inputCls =
  "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50";

export const tableCls = {
  wrap: "relative overflow-x-auto",
  table: "w-full min-w-[640px] text-left text-sm",
  th: "border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap",
  td: "border-b px-4 py-3 align-top",
};
