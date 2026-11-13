# Submission checklist

NIAT GRIT · AI Product Engineer assignment, Round 1 · Rahul Upadhyay · deadline 14 November 2026.

Status as of 12 November 2026. "Done" means built and verified as described; anything not done says so.

## Required deliverables

| # | Deliverable | Status | Where |
| --- | --- | --- | --- |
| 1 | Write-up, maximum two pages: journey states and transitions, edge cases and questions with assumptions, data model | **Done.** PDF is 2 A4 pages (checked by `npm run docs:pdf`, which fails above 2) | `docs/GRIT_Assignment_Writeup.pdf`, source `docs/GRIT_Assignment_Writeup.md` |
| 2 | Working prototype: student booking, interviewer availability and daily schedule, outcome recording, interview-team dashboard | **Done.** Runs locally from the repository | Repository root; start with `npm install && npm run dev` |
| 3 | The three most important student-facing messages, exact wording | **Done.** Same text in the app and the document, enforced by a test | `docs/Student_Messages.md`, `src/lib/messages.ts` |
| 4 | Before-and-after student home and badge / interview screens | **Done.** Live comparison page plus screenshots | `/student/preview` in the app; `docs/screenshots/01`–`15` |
| 5 | Loom recording explaining the project and design reasoning | **NOT DONE. Must be recorded by Rahul.** A talk track and click path are ready | `docs/Loom_Walkthrough.md` |

## Links

| Item | Value |
| --- | --- |
| Source repository | <https://github.com/RKU1327/grit-interview-scheduler> |
| Live deployment | **None.** The app is not deployed. It uses a local SQLite file, which serverless hosts do not persist; hosting it would need a Postgres port or a host with a persistent disk. |
| Loom recording | **Not recorded yet.** Add the link here once it exists. |

## What was verified, and how

| Check | Result |
| --- | --- |
| `npm run lint` | Passes, no warnings |
| `npm run typecheck` (TypeScript strict) | Passes |
| `npm test` | 64 unit and integration tests pass |
| `npm run build` | Production build succeeds, 19 routes |
| `npm run test:e2e` | 10 Playwright tests pass against a production build (last run before two housekeeping commits that removed unused UI files and added `.npmrc`; lint, typecheck, unit tests and build were re-run after them) |
| Seeded fixtures match dashboard numbers | Asserted in an integration test and an e2e test |
| Browser check | Every main page loaded in Chromium with no console errors (e2e test); desktop and 390 px mobile screenshots reviewed; no horizontal overflow on mobile (e2e test) |
| Write-up page count | 2 pages, verified programmatically with pdf-lib |
| Fresh-clone setup | Cloned into an empty folder on Windows with no C++ build tools: `npm ci`, `npm run db:setup`, `npm test`, `npm run lint` and `npm run build` succeeded, and the started server created and seeded its database on the first request. The first attempt failed because npm tried to compile the SQLite module; fixed with `.npmrc` (`ignore-scripts=true`). Not tested on macOS or Linux. |

## Functional coverage

| Area | Implemented |
| --- | --- |
| Skill-based eligibility; a student missing a skill cannot book | Yes |
| Real slots from interviewer availability, IST shown, date navigation, confirmation | Yes |
| No double booking of a slot; one live booking per student per badge | Yes (transaction + unique indexes) |
| Cancel and reschedule with visible rules and preserved history | Yes |
| Interviewer availability: create, edit, remove, overlap detection | Yes |
| Availability changes never silently invalidate bookings | Yes (conflict list, explicit keep / release) |
| Daily schedule with date navigation | Yes |
| Outcomes: pass, fail, retake later as distinct results | Yes |
| Guards: no result before start, for cancelled slots, by the wrong interviewer, or twice | Yes |
| Finalised outcomes immutable; team corrections with a reason and an append-only ledger | Yes |
| No-show and interviewer-absent handling | Yes (documented prototype policy) |
| Team overview, eligible roster with booked / unbooked filter and search, all appointments | Yes |
| Malpractice nullification, separate from fail, with reason and confirmation, history preserved | Yes |
| Audit trail of every transition | Yes |
| Demo persona switcher, seeded states, reset with confirmation, guided demo | Yes |

## Known limitations

- **No real authentication.** A demo persona cookie selects who you act as. Server actions check role and ownership, but anyone can switch persona. This is intended for evaluation only.
- **Not deployed.** See above.
- **Policies are assumptions.** Change cut-off, reschedule limit, retake wait, fail needing a team grant, and no-shows not costing an attempt are prototype decisions, listed in the write-up and in `src/domain/policy.ts`. They are not NIAT rules.
- **No notifications, calendar invites or meeting link.** The three key messages are shown in-app only.
- **Availability is entered as dated windows**, not recurring rules.
- **Single time zone.** Everything is displayed in IST by design; storage is UTC.
- **Nullification cannot be reversed** and a nullified badge cannot be re-booked in the prototype.
- **Outcome corrections are limited** to the latest attempt, and a pass can only be removed by nullification.
- **Tier ordering and Miles are not modelled.** Eligibility means "all required skills cleared".
- **Demo clock is global and forward-only.** It exists so a freshly booked interview can be completed in one sitting; "Reset demo data" returns it to real time.
- **SQLite concurrency.** One Node process and SQLite's single writer make the booking transaction safe. A multi-instance deployment would need Postgres and an exclusion constraint.
- **Accessibility** was checked for labels, keyboard operation and focus states, not audited against WCAG with assistive technology.

## Still to do before submitting

1. Record the Loom (3–5 minutes) using `docs/Loom_Walkthrough.md` and add the link to this file and to the submission form.
2. Skim the write-up PDF once and adjust any assumption you would phrase differently.
3. Optional: run `npm run package` to produce `submission/grit-interview-scheduler.zip` if a ZIP upload is requested.
4. Submit the repository link, the PDF and the Loom link before 14 November 2026.
