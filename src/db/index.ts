import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { seedDemoData } from "./seed-data";

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export function databasePath(): string {
  return process.env.DATABASE_URL ?? path.join(process.cwd(), "data", "grit.db");
}

/** Open a database, apply pragmas and run pending migrations. */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

// Keep a single connection across Next.js hot reloads.
const globalForDb = globalThis as unknown as { __gritDb?: Db };

/**
 * App-wide connection. On first use it migrates the schema and, if the
 * database is empty, seeds the demo fixtures so a fresh clone works with
 * nothing more than `npm install && npm run dev`.
 */
export function getDb(): Db {
  if (!globalForDb.__gritDb) {
    const db = openDatabase(databasePath());
    const empty = db.select({ id: schema.students.id }).from(schema.students).limit(1).all().length === 0;
    if (empty) {
      seedDemoData(db, new Date());
    }
    globalForDb.__gritDb = db;
  }
  return globalForDb.__gritDb;
}

export { schema };
