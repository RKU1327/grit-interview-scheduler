import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/db/schema";
import { bookAppointment } from "../src/domain/booking";

const args = JSON.parse(process.argv[2]) as { url: string; studentId: string; badgeId: string; interviewerId: string; startsAt: string; now: string };
const client = createClient({ url: args.url });
const db = drizzle(client, { schema });
process.send?.("ready");
process.once("message", async () => {
  try {
    await bookAppointment(db, {
      studentId: args.studentId, badgeId: args.badgeId, interviewerId: args.interviewerId, startsAt: args.startsAt,
      actor: { role: "student", id: args.studentId, name: args.studentId }, now: new Date(args.now),
    });
    process.send?.("booked");
  } catch {
    process.send?.("rejected");
  } finally {
    client.close();
    process.disconnect?.();
  }
});
