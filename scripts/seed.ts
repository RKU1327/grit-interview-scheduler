import { databasePath, openDatabase } from "@/db";
import { resetDemoData } from "@/db/seed-data";
import { getOverview } from "@/domain/queries";

const db = openDatabase(databasePath());
resetDemoData(db);
const o = getOverview(db, new Date());
console.log(`Seeded demo data into ${databasePath()}`);
console.log(
  `  eligible ${o.eligible} · unbooked ${o.unbooked} · booked ${o.booked} · outcome pending ${o.outcomePending} · completed ${o.completed}`,
);
