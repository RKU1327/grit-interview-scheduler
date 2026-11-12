import { ShieldAlert } from "lucide-react";
import { switchPersonaAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, type Persona, type Role } from "@/lib/persona";

/** Section guard: each area only renders for its own persona. */
export function RoleGate({ need, persona, children }: { need: Role; persona: Persona; children: React.ReactNode }) {
  if (persona.role === need) return <>{children}</>;
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border bg-card p-6 text-center shadow-xs">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-800">
        <ShieldAlert className="size-5" aria-hidden />
      </div>
      <h1 className="text-base font-semibold">This area is for the {ROLE_LABEL[need]} persona</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You are currently viewing the demo as {ROLE_LABEL[persona.role]}. Switch persona to continue.
      </p>
      <form action={switchPersonaAction.bind(null, need, undefined)} className="mt-4">
        <Button type="submit">Switch to {ROLE_LABEL[need]}</Button>
      </form>
    </div>
  );
}
