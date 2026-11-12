import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allKeyMessageStrings, fill, KEY_MESSAGES, NULLIFIED_MESSAGE } from "@/lib/messages";

const doc = readFileSync(path.join(process.cwd(), "docs", "Student_Messages.md"), "utf8");

describe("key student messages", () => {
  it("are documented verbatim in docs/Student_Messages.md", () => {
    for (const text of [...allKeyMessageStrings(), NULLIFIED_MESSAGE.title, NULLIFIED_MESSAGE.body])
      expect(doc, `missing from docs: "${text.slice(0, 60)}..."`).toContain(text);
  });

  it("fills every placeholder when rendered", () => {
    const vars = {
      badgeName: "Full-Stack Web · Novice",
      skillCount: 4,
      date: "13 Nov 2026",
      weekdayDate: "Friday, 13 November 2026",
      startTime: "10:30 AM",
      endTime: "11:00 AM",
      interviewerName: "Priya Panelist",
      changeDeadline: "13 Nov 2026, 8:30 AM IST",
      firstName: "Tara",
      interviewDate: "13 Nov 2026",
      retakeDate: "20 Nov 2026",
    };
    for (const text of allKeyMessageStrings()) expect(fill(text, vars)).not.toMatch(/\{\w+\}/);
    expect(fill(KEY_MESSAGES.bookingConfirmed.title, vars)).toBe("Your interview is booked for 13 Nov 2026 at 10:30 AM IST");
  });

  it("states the time zone in the booking confirmation and keeps fail and retake distinct", () => {
    expect(KEY_MESSAGES.bookingConfirmed.body).toContain("IST (Asia/Kolkata)");
    expect(KEY_MESSAGES.result.retake_later.body).toContain("This is not a fail");
    expect(KEY_MESSAGES.result.fail.body).not.toEqual(KEY_MESSAGES.result.retake_later.body);
  });
});
