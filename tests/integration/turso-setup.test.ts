import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fork } from "node:child_process";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { listOpenSlots } from "@/domain/booking";
import { migrateTurso, resetHostedDemo, seedTursoIfEmpty } from "@/db/turso-setup";

describe("libSQL initialization", () => {
  it("applies the schema and seeds once without overwriting subsequent changes", async () => {
    const client = createClient({ url: "file::memory:" });
    try {
      await migrateTurso(client);
      await migrateTurso(client);
      expect(await seedTursoIfEmpty(client, new Date("2026-11-13T06:00:00Z"))).toBe("seeded");
      expect(Number((await client.execute("SELECT count(*) AS n FROM students")).rows[0].n)).toBe(13);
      await client.execute("UPDATE students SET name = 'Changed demo' WHERE id = 'stu_mira'");
      expect(await seedTursoIfEmpty(client)).toBe("already-initialized");
      expect((await client.execute("SELECT name FROM students WHERE id = 'stu_mira'")).rows[0].name).toBe("Changed demo");
      expect((await client.execute("PRAGMA index_list('appointments')")).rows.map((row) => row.name)).toContain("uq_appt_interviewer_slot");
    } finally {
      client.close();
    }
  });

  it("refuses to seed over a partially populated database", async () => {
    const client = createClient({ url: "file::memory:" });
    try {
      await migrateTurso(client);
      await client.execute("INSERT INTO skills (id, code, name) VALUES ('existing', 'existing', 'Existing')");
      await expect(seedTursoIfEmpty(client)).rejects.toThrow("already populated");
      expect(Number((await client.execute("SELECT count(*) AS n FROM students")).rows[0].n)).toBe(0);
      expect(Number((await client.execute("SELECT count(*) AS n FROM skills")).rows[0].n)).toBe(1);
    } finally {
      client.close();
    }
  });

  it("rolls back every fixture and its marker when an insert fails", async () => {
    const client = createClient({ url: "file::memory:" });
    try {
      await migrateTurso(client);
      await client.execute("CREATE TRIGGER fail_seed BEFORE INSERT ON students BEGIN SELECT RAISE(ABORT, 'seed failure'); END");
      await expect(seedTursoIfEmpty(client)).rejects.toThrow();
      expect(Number((await client.execute("SELECT count(*) AS n FROM skills")).rows[0].n)).toBe(0);
      expect(Number((await client.execute("SELECT count(*) AS n FROM app_meta")).rows[0].n)).toBe(0);
    } finally {
      client.close();
    }
  });

  it("resets the shared demo atomically and preserves it if a reset fails", async () => {
    const client = createClient({ url: "file::memory:" });
    try {
      await migrateTurso(client);
      await seedTursoIfEmpty(client);
      await client.execute("UPDATE students SET name = 'Changed demo' WHERE id = 'stu_mira'");
      await resetHostedDemo(client);
      expect((await client.execute("SELECT name FROM students WHERE id = 'stu_mira'")).rows[0].name).toBe("Mira Notyet");
      await client.execute("CREATE TRIGGER fail_reset BEFORE INSERT ON students BEGIN SELECT RAISE(ABORT, 'reset failure'); END");
      const before = await client.execute("SELECT * FROM students ORDER BY id");
      await expect(resetHostedDemo(client)).rejects.toThrow();
      expect((await client.execute("SELECT * FROM students ORDER BY id")).rows).toEqual(before.rows);
    } finally { client.close(); }
  });

  it("does not allow simultaneous writers to book the same slot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grit-libsql-race-"));
    const url = pathToFileURL(join(dir, "race.db")).href;
    const first = createClient({ url });
    const now = new Date("2026-11-13T03:30:00Z");
    try {
      await migrateTurso(first);
      await seedTursoIfEmpty(first, now);
      const db1 = drizzle(first, { schema });
      const slot = (await listOpenSlots(db1, { from: now, to: new Date("2026-11-14T03:30:00Z"), now }))[0];
      expect(slot).toBeDefined();
      const workers = [["stu_kabir", "bdg_fullstack"], ["stu_sam", "bdg_ai"]].map(([studentId, badgeId]) =>
        fork(join(process.cwd(), "tests/booking-race-worker.ts"), [JSON.stringify({ url, studentId, badgeId, interviewerId: slot.interviewerId, startsAt: slot.startsAt, now: now.toISOString() })], { execArgv: ["--import", "tsx"], silent: true }),
      );
      await Promise.all(workers.map((worker) => new Promise<void>((resolveReady, reject) => {
        worker.once("message", () => resolveReady()); worker.once("error", reject);
      })));
      const results = workers.map((worker) => new Promise<string>((resolveResult, reject) => {
        worker.once("message", (message) => resolveResult(String(message))); worker.once("error", reject);
      }));
      for (const worker of workers) worker.send("start");
      expect((await Promise.all(results)).filter((r) => r === "booked")).toHaveLength(1);
      const matching = await first.execute({ sql: "SELECT count(*) AS n FROM appointments WHERE interviewer_id = ? AND starts_at = ? AND status = 'scheduled'", args: [slot.interviewerId, slot.startsAt] });
      expect(Number(matching.rows[0].n)).toBe(1);
    } finally {
      first.close();
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup path");
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 20000);
});
