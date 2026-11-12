import { databasePath, openDatabase } from "@/db";

// openDatabase applies every pending migration in ./drizzle.
openDatabase(databasePath());
console.log(`Migrations applied to ${databasePath()}`);
