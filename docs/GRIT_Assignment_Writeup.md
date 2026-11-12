# GRIT Interview Scheduler

<p class="meta">NIAT GRIT · AI Product Engineer assignment, Round 1 · Rahul Upadhyay · Prototype: github.com/RKU1327/grit-interview-scheduler</p>

A student who clears every skill a Track Badge needs books a live interview; interviewers offer time and record results; the interview team sees who is eligible, booked and waiting. The core design decision: **four separate lifecycles, never one status enum.** "Booked", "failed" and "nullified" answer different questions about different records, so each has its own table, states and rules. What a screen shows ("journey state") is a read-only projection of the four.

## 1. Journey states and transitions

| Lifecycle (table) | States | Transitions and guards |
|---|---|---|
| **Eligibility** `badge_eligibilities` | locked → **eligible** | Created by the system the moment the last required skill is cleared. Timestamped once, never revoked; replays of a skill completion are no-ops. |
| **Appointment** `appointments` | **scheduled** → completed · cancelled · rescheduled · no_show · interviewer_absent | Only `scheduled` can change; all others are terminal. *Book:* eligible, slot real, free and ≥ 30 min ahead. *Cancel / reschedule (student):* until 2 h before start, max 2 reschedules per attempt; a reschedule closes the old row and inserts a linked new one. *Completed:* interviewer confirms or records a result, only after the start time. |
| **Attempt** `interview_attempts` + `attempt_outcomes` | awaiting_interview → awaiting_outcome → **passed · failed · retake_later** | Forward-only. One outcome per attempt; final states are immutable to interviewers. A repeated identical submit is a no-op; a different one is rejected. The interview team may *correct* fail ↔ retake or either → pass, with a reason, as a new ledger row. |
| **Badge** `badge_awards` | not_earned → **earned** → **nullified** | Earned in the same transaction as a pass. Nullified only by the interview team after confirmed malpractice, with a reason. Terminal. The pass, the award and its date are all preserved. |

**Attempts vs appointments.** An attempt is one go at the interview that ends in one result; an appointment is one booked slot. A cancelled, rescheduled or missed slot has no result, so the attempt stays open and the next booking reuses it. A new attempt (attempt_no + 1) starts only after a result. That is how a student can show *Attempt 1: failed* and *Attempt 2: scheduled* at once, with nothing overwritten.

**When may a student book?** (one function, `bookingGate`, used by the UI and re-checked inside the booking transaction)

| Situation | Can book? | Student sees |
|---|---|---|
| Missing a skill | No | Skills still to clear |
| Eligible, no attempt; or open attempt with no live slot | Yes | Eligibility message / "book a new slot" |
| Live booking, or result pending | No | Booking details / "result pending" |
| Last result **retake later** | Yes, from the date the interviewer set (0–14 days) | Retake message with the date |
| Last result **fail** | Only after the interview team opens one new attempt (single-use grant) | Fail message; booking appears if granted |
| Badge earned or nullified | No | Badge / nullified status |

**Journey states shown to the student** (derived, in priority order): nullified → earned → locked → result pending → booked → failed → retake later → eligible, unbooked. "Result pending" covers both a `completed` appointment and a `scheduled` one whose time has passed, so a forgotten result never looks like an upcoming interview.

## 2. Edge cases, open questions and assumptions

| Edge case | Handling in the prototype |
|---|---|
| Two students take the same slot; double click / refresh / retried request | Booking runs in one `BEGIN IMMEDIATE` transaction that re-checks the gate and the slot. Partial unique indexes are the final guard. The loser gets "someone just booked that slot" and a refreshed list. A client idempotency key returns the first result on replay. |
| Slot changes while the student is choosing | Slots are computed from availability on every load, auto-refresh every 20 s, and are re-validated on confirm. |
| Interviewer edits or removes availability that contains bookings | Refused with the affected interviews listed. The interviewer must explicitly choose *keep* or *release*; release cancels those slots on their behalf and the student is asked to re-book, with no penalty. |
| Overlapping availability; interviewer double-booking; student double-booked across badges | Overlap rejected in the service layer; one live appointment per interviewer slot and per student start time enforced by unique indexes. |
| Past, off-grid or too-soon times | Rejected server-side, whatever the client sends. |
| Result not recorded after the interview | Student sees "result pending"; interviewer and team get an "outcomes pending" queue. |
| Result entered early, for a cancelled slot, or by the wrong interviewer | Blocked: only the assigned interviewer or the team, only for scheduled/completed slots, only after the start. |
| No-show | **Student no-show** (interviewer, ≥ 10 min after start) and **interviewer absent** (team) close the slot with no result; the attempt stays open. No-shows are counted for the team. |
| Fail vs retake later | Different outcomes, different messages, different rules (see table above). |
| Malpractice found after a pass | Nullification is a separate, team-only action with a reason and an explicit confirmation. It is not a "fail": the attempt stays `passed`, the award row stays, a `badge_nullifications` row and an audit event are added. |
| Time zones and date boundaries | Stored in UTC (ISO-8601), ranges half-open `[start, end)`. Everything is displayed in IST with the label; days are IST calendar days. Tests run the browser in New York time. |

**Questions I would ask, and what I assumed meanwhile.** (Prototype policy, not NIAT policy.)

- *How many attempts, and how soon?* Assumed: retake = self-serve after an interviewer-set wait; fail = team must re-open. No cap, no cool-down invented.
- *Does a no-show cost an attempt?* Assumed no; it is visible to the team, who can act on patterns.
- *Can a nullified badge be re-earned, and who confirms malpractice?* Assumed no re-booking; confirmation is the team's, outside this tool.
- *Do students choose the interviewer?* Assumed slots show the interviewer but students pick by time.
- *Slot length, cut-offs, reschedule limit?* Assumed 30 min, 2 h, 2: constants in one file (`policy.ts`).
- *Do later-tier badges require the earlier tier, and should badges award Miles?* Out of scope; eligibility is skills-only here.
- *Notifications (email/WhatsApp) and the meeting link?* Not built; messages are in-app only.

## 3. Data model

SQLite + Drizzle. Text primary keys; every timestamp is a UTC ISO string. **PK** primary key, **FK** foreign key, **UQ** unique.

| Table | Key fields | Constraints / notes |
|---|---|---|
| `students`, `interviewers` | id **PK**, name, email **UQ** | Reference data. |
| `skills` | id **PK**, code **UQ**, name | |
| `track_badges` | id **PK**, slug **UQ**, track, tier, interview_minutes | |
| `badge_skill_requirements` | badge_id **FK**, skill_id **FK** | **PK**(badge_id, skill_id). |
| `student_skill_completions` | student_id **FK**, skill_id **FK**, cleared_at | **PK**(student_id, skill_id) makes duplicates harmless. |
| `badge_eligibilities` | id, student_id **FK**, badge_id **FK**, eligible_at | **UQ**(student_id, badge_id). Derived fact, snapshotted for "eligible since". |
| `availability_windows` | id, interviewer_id **FK**, starts_at, ends_at | CHECK ends > starts; index (interviewer_id, starts_at); overlap checked in a transaction. |
| `interview_attempts` | id, student_id **FK**, badge_id **FK**, attempt_no, status, retake_available_at | **UQ**(student, badge, attempt_no); partial **UQ**(student, badge) WHERE status is open → one open attempt. |
| `appointments` | id, attempt_id **FK**, student_id, badge_id, interviewer_id **FK**, starts_at, ends_at, status, closed_by, close_reason, rescheduled_from_id, idempotency_key **UQ** | Partial **UQ**(interviewer_id, starts_at) WHERE live → no double booking. Partial **UQ**(attempt_id) WHERE scheduled → one live booking per badge. Partial **UQ**(student_id, starts_at) WHERE scheduled. CHECK on status and range. |
| `attempt_outcomes` | id, attempt_id **FK**, appointment_id **FK**, outcome, private_notes, recorded_by, recorded_at, is_current, supersedes_id, correction_reason | Append-only ledger. Partial **UQ**(attempt_id) WHERE is_current. Notes never reach the student. |
| `attempt_grants` | id, student_id, badge_id, reason, granted_by, consumed_by_attempt_id **FK** | Partial **UQ**(student, badge) WHERE unused. |
| `badge_awards` | id, student_id, badge_id, attempt_id **FK UQ**, status, awarded_at | Partial **UQ**(student, badge) WHERE active. |
| `badge_nullifications` | id, award_id **FK UQ**, reason, confirmed_by, created_at | One per award. |
| `audit_events` | id, entity_type, entity_id, student_id, event_type, from_state, to_state, actor, summary, detail, created_at | Append-only; written in the same transaction as the change it records. |

**Relationships.** student 1—n completions n—1 skill · badge n—n skill · student + badge 1—1 eligibility, 1—n attempts · attempt 1—n appointments n—1 interviewer · attempt 1—n outcomes (one current) · attempt 1—0..1 award 1—0..1 nullification.

**Enforced where.** *Database:* uniqueness of slots, live bookings, open attempts, current outcome, active award; value and range checks; foreign keys. *Service layer, inside the transaction:* eligibility gate, availability containment and overlap, time rules, role and ownership, allowed transitions. SQLite has no range-exclusion constraint, so overlap rules rely on fixed 30-minute slots plus its single-writer transactions; on Postgres I would use an exclusion constraint.
