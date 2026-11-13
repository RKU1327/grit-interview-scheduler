import { databasePath, openDatabase } from "@/db";

async function main() {
  const db = await openDatabase(databasePath());
  db.$client.close();
  console.log(`Migrations applied to ${databasePath()}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
