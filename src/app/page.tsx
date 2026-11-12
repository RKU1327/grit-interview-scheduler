import { redirect } from "next/navigation";
import { getPersona, ROLE_HOME } from "@/lib/persona";

export default async function Index() {
  const persona = await getPersona();
  redirect(ROLE_HOME[persona.role]);
}
