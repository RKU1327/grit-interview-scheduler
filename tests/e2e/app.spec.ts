import { expect, test, type Page } from "@playwright/test";

const HOME = { student: "/student", interviewer: "/interviewer", team: "/team" } as const;
type Role = keyof typeof HOME;

/** yyyy-MM-dd in IST, `offset` days from today (mirrors the app's dayKey). */
const istDay = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + offset * 86_400_000));

async function resetDemo(page: Page) {
  await page.goto("/demo");
  await page.getByTestId("reset-demo").click();
  await page.getByTestId("reset-demo-confirm").click();
  await expect(page.getByText("Demo data reset to its starting state.")).toBeVisible();
}

/** Switch demo persona through the real persona switcher. */
async function actAs(page: Page, role: Role, personId?: string) {
  if (!page.url().startsWith("http")) await page.goto("/demo");
  const roleButton = page.getByTestId(`persona-${role}`);
  if ((await roleButton.getAttribute("aria-pressed")) !== "true") {
    await roleButton.click();
    await expect(page.getByTestId(`persona-${role}`)).toHaveAttribute("aria-pressed", "true");
  }
  if (personId && role !== "team") {
    const select = page.getByTestId(`persona-${role}-select`);
    if ((await select.inputValue()) !== personId) {
      await select.selectOption(personId);
      await expect(page.getByTestId(`persona-${role}-select`)).toHaveValue(personId);
    }
  }
  await page.goto(HOME[role]);
}

async function bookFirstSlot(page: Page) {
  const slot = page.getByTestId("slot").first();
  await expect(slot).toBeVisible();
  const picked = { start: await slot.getAttribute("data-start"), interviewer: await slot.getAttribute("data-interviewer") };
  await slot.click();
  await page.getByTestId("review-booking").click();
  await expect(page.getByRole("dialog")).toContainText("India Standard Time (Asia/Kolkata)");
  await page.getByTestId("confirm-booking").click();
  return picked as { start: string; interviewer: string };
}

async function publishOutcome(page: Page, outcome: "pass" | "fail" | "retake_later") {
  await page.getByTestId(`outcome-${outcome}`).check({ force: true });
  await page.getByTestId("outcome-notes").fill("E2E private note");
  await page.getByTestId("outcome-submit").click();
  await page.getByTestId("outcome-confirm").click();
  await expect(page.getByTestId("outcome-final")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

test("workflow 1: clear final skill -> eligible -> book -> visible to interviewer and team", async ({ page }) => {
  await actAs(page, "student", "stu_mira");
  await expect(page.getByTestId("msg-locked")).toBeVisible();
  await expect(page.getByTestId("msg-eligibility")).toHaveCount(0);

  // Missing one skill: booking is refused even by direct URL.
  await page.goto("/student/badges/full-stack-web-novice/book");
  await expect(page.getByTestId("booking-blocked")).toContainText("Clear every required skill contest");

  await page.goto("/student/badges/full-stack-web-novice");
  await expect(page.getByTestId("badge-detail")).toHaveAttribute("data-journey", "locked");
  await page.getByTestId("clear-skill-react").click();
  await expect(page.getByTestId("msg-eligibility")).toContainText("You're eligible for the Full-Stack Web · Novice interview");
  await expect(page.getByTestId("badge-detail")).toHaveAttribute("data-journey", "eligible_unbooked");

  await page.getByTestId("cta-book").click();
  await expect(page.getByTestId("tz-notice")).toContainText("India Standard Time");
  const picked = await bookFirstSlot(page);

  await expect(page.getByTestId("msg-booking-confirmed")).toContainText("Your interview is booked for");
  await expect(page.getByTestId("msg-booking-confirmed")).toContainText("IST (Asia/Kolkata)");
  await expect(page.getByTestId("badge-detail")).toHaveAttribute("data-journey", "booked");

  // A second booking for the same badge is refused.
  await page.goto("/student/badges/full-stack-web-novice/book");
  await expect(page.getByTestId("booking-blocked")).toContainText("already have an interview booked");

  await page.goto("/student");
  await expect(page.getByTestId("student-home")).toContainText("Upcoming interviews");
  await expect(page.getByTestId("badge-card-full-stack-web-novice")).toHaveAttribute("data-journey", "booked");

  // Interviewer sees it on the right day.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(picked.start));
  await actAs(page, "interviewer", picked.interviewer);
  await page.goto(`/interviewer?date=${day}`);
  await expect(page.locator('[data-testid="schedule-row"][data-student="stu_mira"]')).toContainText("Mira Notyet");

  // Team roster and overview reflect it.
  await actAs(page, "team");
  await expect(page.getByTestId("stat-eligible")).toHaveText("12");
  await expect(page.getByTestId("stat-booked")).toHaveText("4");
  await page.goto("/team/roster?state=booked");
  await expect(page.locator('[data-testid="roster-row"][data-student="stu_mira"]')).toHaveAttribute("data-journey", "booked");
});

test("seeded dashboard numbers match the fixtures", async ({ page }) => {
  await actAs(page, "team");
  const expected = {
    "stat-eligible": "11",
    "stat-unbooked": "3",
    "stat-booked": "3",
    "stat-pending": "1",
    "stat-completed": "5",
    "result-pass": /^2/,
    "result-fail": /^2/,
    "result-retake_later": /^1/,
    "stat-badges-active": "1",
    "stat-badges-nullified": "1",
    "stat-noshows": "1",
  };
  for (const [id, value] of Object.entries(expected)) await expect(page.getByTestId(id)).toHaveText(value);

  await page.goto("/team/roster");
  await expect(page.getByTestId("roster-row")).toHaveCount(11);
  await page.getByTestId("roster-filter-eligible_unbooked").click();
  await expect(page.getByTestId("roster-row")).toHaveCount(3);
  await page.getByTestId("roster-search").fill("kabir");
  await expect(page.getByTestId("roster-row")).toHaveCount(1);
  await expect(page.getByTestId("roster-row")).toContainText("Nudge student to book");
});

test("workflow 2: interviewer records pass -> student earns badge -> reporting updates", async ({ page }) => {
  await actAs(page, "interviewer", "int_priya");
  await page.getByTestId("record-stu_dev").click();
  await publishOutcome(page, "pass");
  // A refresh / second visit cannot record again: the form is gone.
  await page.reload();
  await expect(page.getByTestId("outcome-form")).toHaveCount(0);
  await expect(page.getByTestId("outcome-final")).toContainText("Pass");

  await actAs(page, "student", "stu_dev");
  await expect(page.getByTestId("msg-result-pass")).toContainText("You passed. The Data Analytics · Novice badge is yours.");
  await expect(page.getByTestId("badge-card-data-analytics-novice")).toHaveAttribute("data-journey", "passed");
  await page.goto("/student/badges/data-analytics-novice");
  await expect(page.getByTestId("badge-detail")).toHaveAttribute("data-journey", "passed");

  await actAs(page, "team");
  await expect(page.getByTestId("stat-pending")).toHaveText("0");
  await expect(page.getByTestId("result-pass")).toHaveText(/^3/);
  await expect(page.getByTestId("stat-badges-active")).toHaveText("2");
});

test("workflows 3 and 4: fail and retake later are distinct, history is kept, early results are blocked", async ({ page }) => {
  // Retake later for Dev.
  await actAs(page, "interviewer", "int_priya");
  await page.getByTestId("record-stu_dev").click();
  await publishOutcome(page, "retake_later");

  // Tara's interview is tomorrow: no result before it starts.
  await page.goto(`/interviewer?date=${istDay(1)}`);
  await page.locator('[data-testid="schedule-row"][data-student="stu_tara"] a').click();
  await expect(page.getByTestId("outcome-too-early")).toBeVisible();
  await expect(page.getByTestId("outcome-form")).toHaveCount(0);
  await page.getByTestId("jump-clock").click();
  await expect(page.getByTestId("demo-clock")).toBeVisible();
  await publishOutcome(page, "fail");

  await actAs(page, "student", "stu_dev");
  await expect(page.getByTestId("msg-result-retake_later")).toContainText("retake needed");
  await expect(page.getByTestId("msg-result-retake_later")).toContainText("This is not a fail");

  await actAs(page, "student", "stu_tara");
  await expect(page.getByTestId("msg-result-fail")).toContainText("not passed");
  await page.goto("/student/badges/full-stack-web-novice");
  await expect(page.getByTestId("attempt-1")).toContainText("Fail");
  // A failed student cannot self-book.
  await page.goto("/student/badges/full-stack-web-novice/book");
  await expect(page.getByTestId("booking-blocked")).toContainText("only when the GRIT interview team allows one");

  // Team opens a new attempt; the failed attempt stays in history.
  await actAs(page, "team");
  await page.goto("/team/students/stu_tara");
  await page.getByTestId("grant-reattempt").click();
  await page.getByRole("dialog").getByRole("textbox").fill("Completed the revision module (e2e)");
  await page.getByTestId("grant-reattempt-confirm").click();
  await expect(page.getByText("New attempt opened. The student can now book.")).toBeVisible();

  await actAs(page, "student", "stu_tara");
  await expect(page.getByTestId("msg-grant")).toBeVisible();
  await page.getByTestId("msg-grant").getByTestId("cta-book").click();
  await bookFirstSlot(page);
  await expect(page.getByTestId("msg-booking-confirmed")).toBeVisible();
  await expect(page.getByTestId("attempt-2")).toContainText("Awaiting interview");
  await expect(page.getByTestId("attempt-1")).toContainText("Fail");
});

test("workflow 5: reschedule then cancel keeps history and frees the slot", async ({ page }) => {
  await actAs(page, "student", "stu_tara");
  await page.goto("/student/badges/full-stack-web-novice");
  await page.getByTestId("reschedule-link").click();
  await expect(page.getByRole("heading", { name: "Reschedule your interview" })).toBeVisible();
  const moved = await bookFirstSlot(page);
  await expect(page.getByText("Interview rescheduled.")).toBeVisible();
  await expect(page.getByTestId("attempt-1")).toContainText("Rescheduled");
  await expect(page.getByTestId("attempt-1")).toContainText("Scheduled");

  // Interviewer's schedule shows the old slot as rescheduled.
  await actAs(page, "interviewer", "int_priya");
  await page.goto(`/interviewer?date=${istDay(1)}`);
  await expect(
    page.locator('[data-testid="schedule-row"][data-student="stu_tara"]').filter({ hasText: "Rescheduled" }),
  ).toHaveCount(1);

  await actAs(page, "student", "stu_tara");
  await page.goto("/student/badges/full-stack-web-novice");
  await page.getByTestId("cancel-booking").click();
  await page.getByRole("dialog").getByRole("textbox").fill("Exam clash (e2e)");
  await page.getByTestId("cancel-booking-confirm").click();
  await expect(page.getByTestId("msg-rebook")).toBeVisible();
  await expect(page.getByTestId("booking-panel")).toHaveCount(0);
  await expect(page.getByTestId("attempt-1")).toContainText("Cancelled");

  // The released slot is bookable again.
  await page.getByTestId("msg-rebook").getByTestId("cta-book").click();
  await expect(page.locator(`[data-testid="slot"][data-start="${moved.start}"][data-interviewer="${moved.interviewer}"]`)).toBeVisible();

  await actAs(page, "team");
  await page.goto("/team/appointments?status=cancelled");
  await expect(page.locator('[data-testid="appointment-row"][data-student="stu_tara"]')).toHaveCount(1);
  await page.goto("/team/roster?state=eligible_unbooked");
  await expect(page.locator('[data-testid="roster-row"][data-student="stu_tara"]')).toContainText("re-book");
});

test("workflow 6: team nullifies a badge for malpractice; history is preserved", async ({ page }) => {
  await actAs(page, "team");
  await page.goto("/team/badges");
  const row = page.locator('[data-testid="award-row"][data-student="stu_isha"]');
  await expect(row).toHaveAttribute("data-status", "active");
  await row.getByRole("button", { name: /Nullify for malpractice/ }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Nullify badge" });
  await expect(confirm).toBeDisabled(); // needs a reason and an acknowledgement
  await dialog.getByRole("textbox").fill("Recording review confirmed impersonation (e2e)");
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await confirm.click();
  await expect(row).toHaveAttribute("data-status", "nullified");
  await expect(row).toContainText("Recording review confirmed impersonation (e2e)");

  await page.goto("/team/students/stu_isha");
  const record = page.getByTestId("team-student");
  await expect(record).toContainText("nullified for Isha Passed after confirmed malpractice");
  await expect(record).toContainText("awarded to Isha Passed"); // issuance history remains
  await expect(record).toContainText("Outcome recorded: Pass");

  await actAs(page, "student", "stu_isha");
  await expect(page.getByTestId("msg-nullified")).toContainText("has been nullified");
  await expect(page.getByTestId("badge-card-full-stack-web-novice")).toHaveAttribute("data-journey", "nullified");
  await page.goto("/student/badges/full-stack-web-novice");
  await expect(page.getByTestId("attempt-1")).toContainText("Pass"); // the interview itself is not rewritten
});

test("workflow 7: before / after uses live components and changes with the state", async ({ page }) => {
  await actAs(page, "student", "stu_kabir");
  await page.goto("/student/preview");
  const before = page.getByTestId("preview-pane-before");
  const after = page.getByTestId("preview-pane-after");
  await expect(before.getByTestId("msg-locked")).toBeVisible();
  await expect(after.getByTestId("msg-eligibility")).toBeVisible();

  const expectations: [string, string][] = [
    ["booked", "msg-booking-confirmed"],
    ["awaiting_outcome", "msg-pending"],
    ["passed", "msg-result-pass"],
    ["failed", "msg-result-fail"],
    ["retake_later", "msg-result-retake_later"],
    ["nullified", "msg-nullified"],
  ];
  for (const [state, message] of expectations) {
    await page.getByTestId(`preview-state-${state}`).click();
    await expect(after.getByTestId(message)).toBeVisible();
  }

  await page.getByTestId("preview-screen-badge").click();
  await expect(before.getByTestId("badge-detail")).toHaveAttribute("data-journey", "locked");
  await expect(after.getByTestId("badge-detail")).toHaveAttribute("data-journey", "nullified");
});

test("interviewer availability: overlap is rejected and booked windows are protected", async ({ page }) => {
  await actAs(page, "interviewer", "int_priya");
  await page.goto("/interviewer/availability");
  const tomorrow = istDay(1);

  const form = page.getByTestId("add-window-form");
  await form.getByLabel("Date").fill(tomorrow);
  await form.getByLabel("From (IST)").selectOption("11:00");
  await form.getByLabel("To (IST)").selectOption("12:30");
  await page.getByTestId("add-window").click();
  await expect(page.getByTestId("window-error")).toContainText("overlaps your existing availability");

  // Valid, non-overlapping window.
  await form.getByLabel("From (IST)").selectOption("18:00");
  await form.getByLabel("To (IST)").selectOption("19:00");
  await page.getByTestId("add-window").click();
  await expect(page.getByText("Availability added.")).toBeVisible();

  // Tara is booked tomorrow 10:30 inside the 10:00-13:00 window.
  const morning = page.locator(`[data-testid="window-row"][data-day="${tomorrow}"]`).filter({ hasText: "10:00 AM" });
  await expect(morning).toContainText("1 booked");
  await morning.getByTestId("remove-window").click();
  await page.getByTestId("confirm-remove-window").click();
  const conflict = page.getByTestId("conflict-dialog");
  await expect(conflict).toContainText("Tara Booked");
  await page.getByTestId("conflict-keep").click();
  await expect(morning).toBeVisible(); // nothing changed

  await morning.getByTestId("remove-window").click();
  await page.getByTestId("confirm-remove-window").click();
  await page.getByTestId("conflict-release").click();
  await expect(morning).toHaveCount(0);

  await actAs(page, "student", "stu_tara");
  await expect(page.getByTestId("msg-rebook")).toContainText("interviewer is no longer available");
});

test("personas are separated and pages render without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));

  await actAs(page, "student", "stu_tara");
  await page.goto("/team");
  await expect(page.getByText("This area is for the Interview Team persona")).toBeVisible();
  await page.goto("/interviewer");
  await expect(page.getByText("This area is for the Interviewer persona")).toBeVisible();

  for (const path of ["/student", "/student/interviews", "/student/preview", "/student/badges/full-stack-web-novice", "/demo"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
  }
  await actAs(page, "interviewer", "int_priya");
  for (const path of ["/interviewer", "/interviewer/availability", `/interviewer?date=${istDay(1)}`]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
  }
  await actAs(page, "team");
  for (const path of ["/team", "/team/roster", "/team/appointments", "/team/badges", "/team/activity", "/team/students/stu_zoya"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = async () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await actAs(page, "student", "stu_tara");
  for (const path of ["/student", "/student/badges/full-stack-web-novice", "/student/interviews", "/student/preview"]) {
    await page.goto(path);
    expect(await overflow(), `overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await actAs(page, "student", "stu_kabir");
  await page.goto("/student/badges/full-stack-web-novice/book");
  expect(await overflow(), "overflow on booking").toBeLessThanOrEqual(1);
  await actAs(page, "interviewer", "int_priya");
  for (const path of ["/interviewer", "/interviewer/availability"]) {
    await page.goto(path);
    expect(await overflow(), `overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await actAs(page, "team");
  for (const path of ["/team", "/team/roster", "/team/appointments", "/team/badges", "/demo"]) {
    await page.goto(path);
    expect(await overflow(), `overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});
