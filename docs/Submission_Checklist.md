# Submission checklist

NIAT GRIT · AI Product Engineer assignment, Round 1 · Rahul Upadhyay. The original brief says “Submit before 14 Nov”; it does not specify a year or time zone.

Status as of 14 November 2026. "Done" means built and verified as described; anything not done says so.

The locally available original assignment was reviewed against the deliverables below. It requests the journey, assumptions and data model in at most two pages; a working prototype; three exact messages; before-and-after screens; and a Loom recording. The core booking, availability, outcome, reporting and malpractice flows are represented in the implementation and documented tests. The form itself requires sign-in and its fields could not be inspected in the available browser session.

## Required deliverables

| # | Deliverable | Status | Where |
| --- | --- | --- | --- |
| 1 | Write-up, maximum two pages: journey states and transitions, edge cases and questions with assumptions, data model | **Done.** PDF is 2 A4 pages (checked by `npm run docs:pdf`, which fails above 2) | `docs/GRIT_Assignment_Writeup.pdf`, source `docs/GRIT_Assignment_Writeup.md` |
| 2 | Working prototype: student booking, interviewer availability and daily schedule, outcome recording, interview-team dashboard | **Done.** Public Vercel app backed by Turso; also runs locally | [Guided demo](https://grit-interview-scheduler-alpha.vercel.app/demo); locally use `npm install && npm run dev` |
| 3 | The three most important student-facing messages, exact wording | **Done.** Same text in the app and the document, enforced by a test | `docs/Student_Messages.md`, `src/lib/messages.ts` |
| 4 | Before-and-after student home and badge / interview screens | **Done.** Live comparison page plus screenshots | `/student/preview` in the app; `docs/screenshots/01`–`15` |
| 5 | Loom recording explaining the project and design reasoning | **NOT DONE. Must be recorded by Rahul.** A talk track and click path are ready | `docs/Loom_Walkthrough.md` |

## Links

| Item | Value |
| --- | --- |
| Source repository | <https://github.com/RKU1327/grit-interview-scheduler> |
| Live deployment | <https://grit-interview-scheduler-alpha.vercel.app> · [Guided demo](https://grit-interview-scheduler-alpha.vercel.app/demo) |
| Loom recording | **Not recorded yet.** Add the link here once it exists. |

## What was verified, and how

| Check | Result |
| --- | --- |
| `npm run lint` | Passes, no warnings |
| `npm run typecheck` (TypeScript strict) | Passes |
| `npm test` | 70 unit and integration tests, including a two-process booking race and libSQL initialization/reset checks |
| `npm run build` | Production build succeeds, 19 routes |
| Playwright end-to-end | 10 tests passed against the migrated local production build. The final run allowed 120 seconds per test on the slow Windows machine; assertions were unchanged. |
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

- **Production verification outstanding.** Hosted foreign-key enforcement, hosted schema, token revocation and the deployed revision need direct Turso/Vercel account verification. The schema declares foreign keys, but the hosted connection does not explicitly enable them; do not assume enforcement from the local SQLite setting.
- **Dependency audit (14 November 2026).** npm reported 2 low and 14 moderate findings. The underlying advisories cover `deepmerge` 4.3.1 (prototype poisoning, GHSA-gcqx-w48m-w2h4), `minimatch` 10.2.6 (glob denial of service, GHSA-g3hv-75wg-m249), and development-only `esbuild` 0.18.20 (development-server exposure, GHSA-67mh-4wv8-2f99). The lockfile includes the first two through the `shadcn` CLI dependency chain and the latter through `drizzle-kit`; npm also counts affected dependants. No forced major-version changes were made. Review updates before using the tooling with untrusted inputs.
- **No real authentication.** A demo persona cookie selects who you act as. Server actions check role and ownership, but anyone can switch persona. This is intended for evaluation only.
- **Shared demo.** All evaluators use the same fictional records and demo clock. One person's changes or reset affect others; no visitor has isolated state.
- **Policies are assumptions.** Change cut-off, reschedule limit, retake wait, fail needing a team grant, and no-shows not costing an attempt are prototype decisions, listed in the write-up and in `src/domain/policy.ts`. They are not NIAT rules.
- **No notifications, calendar invites or meeting link.** The three key messages are shown in-app only.
- **Availability is entered as dated windows**, not recurring rules.
- **Single time zone.** Everything is displayed in IST by design; storage is UTC.
- **Nullification cannot be reversed** and a nullified badge cannot be re-booked in the prototype.
- **Outcome corrections are limited** to the latest attempt, and a pass can only be removed by nullification.
- **Tier ordering and Miles are not modelled.** Eligibility means "all required skills cleared".
- **Demo clock is global and forward-only.** It exists so a freshly booked interview can be completed in one sitting; "Reset demo data" returns it to real time.
- **SQLite concurrency.** Turso serializes write transactions; partial unique indexes and transaction-time overlap checks guard booking conflicts.
- **Accessibility** was checked for labels, keyboard operation and focus states, not audited against WCAG with assistive technology.

## Still to do before submitting

1. Record the Loom (3–5 minutes) using `docs/Loom_Walkthrough.md` and provide its link in the submission form.
2. Sign in to the submission form and confirm its required fields and whether the PDF needs a public sharing link. The form requires Google sign-in; its fields were not independently visible during this review.
3. Complete the outstanding production security and deployment checks. Authorized Turso/Vercel access was unavailable during this review.
4. The ZIP is optional and generated from the committed tree with `npm run package`; do not use an older archive. Submit only the artifacts requested by the form.
