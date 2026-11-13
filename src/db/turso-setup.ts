import { createClient, type Client, type InStatement, type InValue } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { openDatabase } from "./index";
import { seedDemoData } from "./seed-data";

// Parents precede children so the same fixture works with foreign keys enabled.
const TABLES = [
  "skills", "track_badges", "students", "interviewers", "badge_skill_requirements",
  "student_skill_completions", "badge_eligibilities", "availability_windows",
  "interview_attempts", "appointments", "attempt_outcomes", "attempt_grants",
  "badge_awards", "badge_nullifications", "audit_events", "app_meta",
] as const;

export async function migrateTurso(client: Client) {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
}

/** Build fixtures locally before taking the remote write lock. */
async function fixtureStatements(now: Date): Promise<InStatement[]> {
  const local = await openDatabase(":memory:");
  try {
    await seedDemoData(local, now);
    const statements: InStatement[] = [];
    for (const table of TABLES) {
      const rows = (await local.$client.execute(`SELECT * FROM "${table}"`)).rows as unknown as Record<string, InValue>[];
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const chunkSize = Math.max(1, Math.floor(900 / columns.length));
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        statements.push({
          sql: `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ")}`,
          args: chunk.flatMap((row) => columns.map((column) => row[column])),
        });
      }
    }
    statements.push("INSERT INTO app_meta (key, value) VALUES ('demo_initialized_v1', '1')");
    return statements;
  } finally { local.$client.close(); }
}

/** Explicit operator action: migrate and seed only a completely empty database. */
export async function seedTursoIfEmpty(client: Client, now = new Date()): Promise<"seeded" | "already-initialized"> {
  const statements = await fixtureStatements(now);
  const tx = await client.transaction("write");
  try {
    const marker = await tx.execute("SELECT value FROM app_meta WHERE key = 'demo_initialized_v1'");
    if (marker.rows.length) { await tx.rollback(); return "already-initialized"; }
    const counts = await tx.execute(TABLES.map((table) => `SELECT '${table}' AS name, count(*) AS n FROM "${table}"`).join(" UNION ALL "));
    if (counts.rows.some((row) => Number(row.n) > 0)) throw new Error("Database is already populated without an initialization marker; initialization was not attempted.");
    await tx.batch(statements);
    await tx.commit();
    return "seeded";
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    throw error;
  }
}

/** Explicit shared-demo reset: delete and insert atomically under the same writer lock. */
export async function resetHostedDemo(client: Client, now = new Date()) {
  const inserts = await fixtureStatements(now);
  const deletes = [...TABLES].reverse().map((table) => `DELETE FROM "${table}"`);
  await client.batch([...deletes, ...inserts], "write");
}

export function createTursoSetupClient(url: string, authToken: string) {
  if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  return createClient({ url, authToken });
}
