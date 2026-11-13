import { createTursoSetupClient, migrateTurso, seedTursoIfEmpty } from "@/db/turso-setup";

async function main() {
  const client = createTursoSetupClient(process.env.TURSO_DATABASE_URL ?? "", process.env.TURSO_AUTH_TOKEN ?? "");
  try {
    await migrateTurso(client);
    const result = await seedTursoIfEmpty(client);
    console.log(result === "seeded" ? "Turso schema migrated and demo initialized." : "Turso schema migrated; existing data was left untouched.");
  } finally {
    client.close();
  }
}

main().catch(() => {
  // Driver errors may include connection details; do not print credentials.
  console.error("Turso setup failed. Check the connection, migrations, and database state before retrying.");
  process.exitCode = 1;
});
