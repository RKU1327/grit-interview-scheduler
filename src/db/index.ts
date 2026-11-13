import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";
import { seedDemoData } from "./seed-data";

export type Db = LibSQLDatabase<typeof schema> & { $client: Client };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function databasePath(): string {
  return process.env.DATABASE_URL ?? path.join(process.cwd(), "data", "grit.db");
}

/** Local development/test database. Hosted migrations are an explicit operation. */
export async function openDatabase(file: string): Promise<Db> {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const client = createClient({ url: file === ":memory:" ? "file::memory:" : pathToFileURL(path.resolve(file)).href, concurrency: 1 });
  const db = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA busy_timeout = 5000");
  if (file !== ":memory:") await client.execute("PRAGMA journal_mode = WAL");
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

const globalForDb = globalThis as unknown as { __gritDb?: Promise<Db> };
export function getDb(): Promise<Db> {
  if (!globalForDb.__gritDb) {
    globalForDb.__gritDb = (async () => {
      const url = process.env.TURSO_DATABASE_URL;
      if (url) {
        if (!process.env.TURSO_AUTH_TOKEN) throw new Error("TURSO_AUTH_TOKEN is required");
        return drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }), { schema });
      }
      if (process.env.VERCEL) throw new Error("TURSO_DATABASE_URL is required on Vercel");
      const db = await openDatabase(databasePath());
      await db.transaction(async (tx) => {
        const empty = (await tx.select({ id: schema.students.id }).from(schema.students).limit(1).all()).length === 0;
        if (empty) await seedDemoData(tx, new Date());
      });
      return db;
    })().catch((error) => { delete globalForDb.__gritDb; throw error; });
  }
  return globalForDb.__gritDb;
}
export { schema };
