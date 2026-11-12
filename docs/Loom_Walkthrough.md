# Loom walkthrough: talk track and recording plan

> **Status: not recorded.** This is a speaking aid for the recording that Rahul still has to make. It is written in the first person so it can be read naturally, but adapt the wording to how you actually speak. Target length 3–5 minutes (about 600 words spoken; the script below is roughly 4 minutes at an unhurried pace).

## Before you press record

1. `npm install`, then `npm run dev`, and open <http://localhost:3000/demo>.
2. Click **Reset demo data** so every seeded state is fresh.
3. Have the PDF `docs/GRIT_Assignment_Writeup.pdf` open in a second tab.
4. Use a 1280–1440 px wide browser window at 100% zoom and close unrelated tabs.
5. Do one silent dry run of the click path below. It takes about two minutes.

## Recording sequence

| # | Time | Screen | What to do |
|---|---|---|---|
| 1 | 0:00 | Write-up PDF, page 1 | State the problem and the "four lifecycles" decision |
| 2 | 0:40 | Student · Mira Notyet · badge page | Show locked state, clear the last skill |
| 3 | 1:05 | Booking page | Pick a slot, point at the time zone, confirm |
| 4 | 1:35 | Interviewer schedule | Show the booking arrived; open it; jump the demo clock; publish a result |
| 5 | 2:15 | Student home | Show the result message and the badge |
| 6 | 2:35 | Interview Team · overview, roster | Show eligible / booked / unbooked and the pending queue |
| 7 | 3:00 | Team · Badges | Nullify a badge with a reason; show the student view and the history |
| 8 | 3:30 | Student · Before / after | Flip through the states |
| 9 | 3:50 | Write-up PDF, page 2 | Trade-offs and what I would do next |

## Talk track

**1. The problem (PDF, page 1)**

"Hi, I'm Rahul. This is my GRIT interview scheduler. The brief sounds like a booking form, but the hard part is that four different things are true about a student at the same time: are they eligible, do they have a slot, what happened in the interview, and do they hold the badge. If you squash those into one status column you get states like 'failed but booked' that nobody can reason about. So the main decision in my design is to keep four separate lifecycles: eligibility, appointment, attempt and outcome, and badge. What the student sees is just a read-only projection of those four."

**2. Becoming eligible (student, Mira Notyet)**

"I'm in demo mode as a student called Mira. She has cleared three of four skills, so there is no way to book, even if I type the booking URL. This demo button stands in for the contest system reporting her last skill. The moment it lands, she gets the first of my three key messages: you're eligible, here's the one thing to do next."

**3. Booking (booking page)**

"These slots aren't a mock list. They are cut from the interviewers' real availability, minus anything already taken. The time zone is stated here, again in the confirmation, and again in the message afterwards, because turning up at the wrong time is the most expensive mistake in this flow. I confirm, and that's the second key message: date, time, IST, who with, and until when she can change it."

**4. Interviewer (schedule and interview page)**

"Switching to the interviewer she booked with: the interview is on their schedule for that day. If I open it, I can't record a result yet, because the interview hasn't started. That guard is deliberate. For the demo I move the demo clock to the start time. Now I can choose pass, fail or retake later. Those are three different outcomes with different consequences, not one flag. I'll publish a pass. Once it's published, the interviewer can't change it. Only the interview team can issue a correction, with a reason, and the original stays in the ledger."

**5. Student result (student home)**

"Back as Mira: the third key message, and the badge is earned on both the home screen and the badge screen. If I had failed her, the message would say plainly that a new attempt only opens if the team allows it. I didn't want the product promising a retake policy that I made up."

**6. Interview team (overview and roster)**

"This is what the interview team asked for. Who is eligible, who has booked, who hasn't, and which interviews happened but have no result. Every number is computed from the records, and there is a test that checks the seeded data matches these counts. The roster filters to 'not booked' so someone can follow up."

**7. Malpractice (team badges, then student)**

"Nullifying a badge is a separate action from failing an interview. It needs a reason and an explicit confirmation. Look at what it does and doesn't change: the student sees 'badge nullified', but the interview is still recorded as a pass, the award is still there with its date, and the audit trail shows who nullified it and why. Nothing is deleted."

**8. Before and after (student preview)**

"For the before-and-after requirement I didn't want static screenshots, so this page renders the real home and badge components for a real student in each state. Before eligibility on the left; booked, passed, failed, retake, nullified on the right."

**9. Trade-offs and next steps (PDF, page 2)**

"Three honest trade-offs. First, the rules I had to invent, like the two-hour change cut-off or a no-show not costing an attempt, are prototype policy. They're in one file and listed as open questions in the write-up. Second, there's no real sign-in; the persona switcher stands in for it, though every action still checks role and ownership on the server. Third, it runs on SQLite, which is fine for a prototype; double-booking is prevented by transactions plus unique indexes, and on Postgres I'd use an exclusion constraint. Next I would add notifications and calendar invites, real authentication, and reminders for interviewers who haven't recorded a result. Thanks for watching."

## If you are short on time (3-minute cut)

Keep sections 1, 2, 3, 4, 5 and 7. Drop the team overview and the before/after page, and mention them in one sentence: "there is also a team dashboard and a live before-and-after page; both are in the README."

## Things to say honestly if asked

- I built this with an AI coding assistant (Claude Code) and directed the product decisions, state model, policies and review. Say so plainly rather than implying every line was typed by hand.
- The app is not deployed; it runs locally from the repository.
- The policies are my assumptions, not NIAT's rules.
