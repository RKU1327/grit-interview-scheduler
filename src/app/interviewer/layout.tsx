import { RoleGate } from "@/components/app/role-gate";
import { getPersona } from "@/lib/persona";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const persona = await getPersona();
  return (
    <RoleGate need="interviewer" persona={persona}>
      {children}
    </RoleGate>
  );
}
