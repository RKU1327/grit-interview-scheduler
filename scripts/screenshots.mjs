// Captures screenshots of the running app into docs/screenshots.
//
//   1. start the app (npm run dev, or npm run build && npm start)
//   2. npm run screenshots            (BASE_URL defaults to http://localhost:3000)
//
// The script resets the demo data first so the pictures always show the
// seeded states, and switches persona through the real persona switcher.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve(process.env.OUT_DIR ?? "docs/screenshots");
const MOBILE = process.env.MOBILE === "1";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: MOBILE ? { width: 390, height: 844 } : { width: 1360, height: 900 },
  deviceScaleFactor: MOBILE ? 2 : 1,
});
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()} ${m.text()}`));
page.on("pageerror", (e) => errors.push(`${page.url()} ${e.message}`));

const shot = async (name, opts = {}) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, ...opts });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`  ${name}.png${overflow > 1 ? `   !! horizontal overflow ${overflow}px` : ""}`);
};

async function actAs(role, personId) {
  const button = page.getByTestId(`persona-${role}`);
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
    await page.waitForFunction((r) => document.querySelector(`[data-testid="persona-${r}"]`)?.getAttribute("aria-pressed") === "true", role);
  }
  if (personId) {
    const select = page.getByTestId(`persona-${role}-select`);
    if ((await select.inputValue()) !== personId) {
      await select.selectOption(personId);
      await page.waitForFunction(
        ([r, id]) => document.querySelector(`[data-testid="persona-${r}-select"]`)?.value === id,
        [role, personId],
      );
    }
  }
}
const go = (p) => page.goto(BASE + p, { waitUntil: "networkidle" });

console.log(`Capturing ${MOBILE ? "mobile" : "desktop"} screenshots from ${BASE} -> ${OUT}`);
await go("/demo");
await page.getByTestId("reset-demo").click();
await page.getByTestId("reset-demo-confirm").click();
await page.getByText("Demo data reset to its starting state.").waitFor();
await go("/demo");
await shot("00-guided-demo");

// Student: before -> after
await actAs("student", "stu_mira");
await go("/student");
await shot("01-student-home-before-eligibility");
await go("/student/badges/full-stack-web-novice");
await shot("02-student-badge-before-eligibility");

await actAs("student", "stu_kabir");
await go("/student");
await shot("03-student-home-eligible");
await go("/student/badges/full-stack-web-novice/book");
await page.getByTestId("slot").first().click();
await shot("04-student-booking-slots");
await page.getByTestId("review-booking").click();
await page.getByTestId("confirm-booking").waitFor();
await shot("05-student-booking-confirm", { fullPage: false });
await page.keyboard.press("Escape");

await actAs("student", "stu_tara");
await go("/student");
await shot("06-student-home-booked");
await go("/student/badges/full-stack-web-novice");
await shot("07-student-badge-booked");
await go("/student/interviews");
await shot("08-student-my-interviews");

await actAs("student", "stu_isha");
await go("/student");
await shot("09-student-home-passed");
await actAs("student", "stu_rohan");
await go("/student");
await shot("10-student-home-failed");
await actAs("student", "stu_neha");
await go("/student/badges/data-analytics-novice");
await shot("11-student-badge-retake");
await actAs("student", "stu_arjun");
await go("/student/badges/full-stack-web-novice");
await shot("12-student-badge-nullified");

await go("/student/preview?state=passed&screen=home");
await shot("13-before-after-home-passed");
await go("/student/preview?state=booked&screen=badge");
await shot("14-before-after-badge-booked");
await go("/student/preview?state=nullified&screen=home");
await shot("15-before-after-home-nullified");

// Interviewer
await actAs("interviewer", "int_priya");
await go("/interviewer");
await shot("16-interviewer-schedule");
await page.getByTestId("record-stu_dev").click();
await page.getByTestId("outcome-form").waitFor();
await page.getByTestId("outcome-pass").check({ force: true });
await shot("17-interviewer-record-outcome");
await go("/interviewer/availability");
await shot("18-interviewer-availability");

// Interview team
await actAs("team");
await go("/team");
await shot("19-team-overview");
await go("/team/roster");
await shot("20-team-roster");
await go("/team/appointments");
await shot("21-team-appointments");
await go("/team/badges");
await shot("22-team-badges-nullification");
await go("/team/students/stu_arjun");
await shot("23-team-student-history");

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} console error(s):\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("\nDone. No console errors.");
