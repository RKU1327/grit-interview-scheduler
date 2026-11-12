import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * End-to-end tests run against a production build on its own port with its
 * own SQLite file (data/e2e.db), so they never touch the dev database.
 * Tests share one database, so they run serially and reset the demo data
 * through the UI before each test.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    timezoneId: "America/New_York", // prove the UI does not depend on the browser time zone
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: `npm run db:seed && npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/demo`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { DATABASE_URL: "./data/e2e.db" },
  },
});
