# The three key student-facing messages

These are the three messages that matter most in the interview journey. The wording below is exactly what the app renders: the templates live in [`src/lib/messages.ts`](../src/lib/messages.ts), the app fills the `{placeholders}`, and a unit test (`tests/unit/messages.test.ts`) fails if this document and the code ever differ.

All dates and times are rendered in India Standard Time and always carry the `IST` label.

| Placeholder | Filled with | Example |
| --- | --- | --- |
| `{badgeName}` | Track Badge name | Full-Stack Web · Novice |
| `{skillCount}` | Number of required skills | 4 |
| `{date}` / `{interviewDate}` / `{retakeDate}` | Date in IST | 13 Nov 2026 |
| `{weekdayDate}` | Long date in IST | Friday, 13 November 2026 |
| `{startTime}` / `{endTime}` | Slot start and end in IST | 10:30 AM / 11:00 AM |
| `{interviewerName}` | Assigned interviewer | Priya Panelist |
| `{changeDeadline}` | Last moment to reschedule or cancel (2 hours before start) | 13 Nov 2026, 8:30 AM IST |
| `{firstName}` | Student's first name | Tara |

---

## 1. Eligibility earned

**When:** the moment the student clears the last required skill contest for a Track Badge.
**Where:** top of the student home screen and the badge screen (`data-testid="msg-eligibility"`).

> **You're eligible for the {badgeName} interview**
>
> You've cleared all {skillCount} required skills. The last step to earn this Track Badge is a live online interview with a GRIT interviewer. Choose a 30-minute slot that suits you. All times are shown in India Standard Time (IST).
>
> Button: **Book your interview**

## 2. Booking confirmed

**When:** immediately after a slot is booked, and again after a reschedule (with the new time).
**Where:** badge screen after confirming, and the student home screen until the interview (`data-testid="msg-booking-confirmed"`).

> **Your interview is booked for {date} at {startTime} IST**
>
> {badgeName} interview with {interviewerName} on {weekdayDate}, {startTime} – {endTime} IST (Asia/Kolkata). Please be online and ready a few minutes before the start. You can reschedule or cancel until {changeDeadline}. After the interview, your result will appear here as soon as your interviewer records it.
>
> Button: **Manage booking**

## 3. Result published

**When:** the interviewer records the outcome. One variant per outcome; the student sees exactly one.
**Where:** student home screen, badge screen and the result screen (`data-testid="msg-result-pass | msg-result-fail | msg-result-retake_later"`).

### 3a. Pass

> **You passed. The {badgeName} badge is yours.**
>
> Congratulations, {firstName}. Your interviewer recorded a pass for your interview on {interviewDate}, and the badge has been added to your profile. Next step: open your badge to see it, then keep clearing skill contests towards your next Track Badge.
>
> Button: **View your badge**

### 3b. Fail

> **Result for your {badgeName} interview: not passed**
>
> Your interviewer recorded a fail for your interview on {interviewDate}, so this badge has not been awarded. The skills you have cleared stay cleared. Next step: revisit the required skills for this badge. A new interview attempt opens only when the GRIT interview team allows one, and you will see it here if that happens.
>
> Button: **Review required skills**

### 3c. Retake later

> **Result for your {badgeName} interview: retake needed**
>
> Your interviewer has asked you to take this interview again. This is not a fail, and the badge has not been awarded yet. Next step: book a new slot. Booking opens for you on {retakeDate}.
>
> Button: **Book your retake** (shown once the booking date has arrived)

---

## Why these three, and why this wording

- They sit at the three moments where the student must either act or stop worrying: *I can book*, *I am booked*, *I have a result*.
- Each one names the badge, states the fact first, and ends with one concrete next step.
- Message 2 repeats the time zone twice on purpose (`IST` and `Asia/Kolkata`); a wrong-time no-show is the costliest mistake in this flow.
- Message 3 never promises a policy the prototype cannot guarantee. The fail variant says a new attempt opens *only when the interview team allows one*; the retake variant gives a date because the interviewer set one.

## Supporting status copy (not one of the three)

Routine feedback the app also shows, listed for completeness:

- **Badge nullified:** "Your {badgeName} badge has been nullified" / "The badge you earned on {awardedDate} was nullified on {nullifiedDate} after the GRIT interview team confirmed malpractice. It no longer counts as earned. Your interview history stays on record. If you believe this is a mistake, contact the GRIT interview team."
- **Result pending:** "Your {badgeName} result is pending" with the interview time and "There is nothing you need to do right now."
- **Not yet eligible:** "{n} skill(s) to go before your {badgeName} interview" with the missing skills listed.
- **Re-book needed** (after a cancellation, no-show or interviewer unavailability): "Book a new slot for your {badgeName} interview", stating that no result was recorded.
- **New attempt opened** (after a fail, when the team allows one): "A new interview attempt has been opened for you".
