CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`student_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`interviewer_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL,
	`booked_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_by` text,
	`close_reason` text,
	`rescheduled_from_id` text,
	`idempotency_key` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `interview_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`badge_id`) REFERENCES `track_badges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interviewer_id`) REFERENCES `interviewers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_appt_range" CHECK("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "ck_appt_status" CHECK("appointments"."status" in ('scheduled', 'completed', 'cancelled', 'rescheduled', 'no_show', 'interviewer_absent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_idempotency_key_unique` ON `appointments` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_appt_interviewer_slot` ON `appointments` (`interviewer_id`,`starts_at`) WHERE status in ('scheduled', 'completed');--> statement-breakpoint
CREATE UNIQUE INDEX `uq_appt_one_scheduled_per_attempt` ON `appointments` (`attempt_id`) WHERE status = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_appt_student_slot` ON `appointments` (`student_id`,`starts_at`) WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX `ix_appt_interviewer_start` ON `appointments` (`interviewer_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `ix_appt_student` ON `appointments` (`student_id`,`badge_id`);--> statement-breakpoint
CREATE INDEX `ix_appt_status_start` ON `appointments` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `attempt_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`reason` text NOT NULL,
	`granted_by_id` text NOT NULL,
	`granted_by_name` text NOT NULL,
	`created_at` text NOT NULL,
	`consumed_by_attempt_id` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`badge_id`) REFERENCES `track_badges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consumed_by_attempt_id`) REFERENCES `interview_attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_grant_one_unused` ON `attempt_grants` (`student_id`,`badge_id`) WHERE consumed_by_attempt_id is null;--> statement-breakpoint
CREATE TABLE `attempt_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`outcome` text NOT NULL,
	`private_notes` text,
	`recorded_by_role` text NOT NULL,
	`recorded_by_id` text NOT NULL,
	`recorded_by_name` text NOT NULL,
	`recorded_at` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`supersedes_id` text,
	`correction_reason` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `interview_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_outcome_value" CHECK("attempt_outcomes"."outcome" in ('pass', 'fail', 'retake_later'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_outcome_one_current` ON `attempt_outcomes` (`attempt_id`) WHERE is_current = 1;--> statement-breakpoint
CREATE INDEX `ix_outcome_attempt` ON `attempt_outcomes` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`student_id` text,
	`badge_id` text,
	`event_type` text NOT NULL,
	`from_state` text,
	`to_state` text,
	`actor_role` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_audit_entity` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_audit_student` ON `audit_events` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_audit_created` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `availability_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`interviewer_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`interviewer_id`) REFERENCES `interviewers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_window_range" CHECK("availability_windows"."ends_at" > "availability_windows"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `ix_window_interviewer_start` ON `availability_windows` (`interviewer_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `badge_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`status` text NOT NULL,
	`awarded_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`badge_id`) REFERENCES `track_badges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `interview_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_award_status" CHECK("badge_awards"."status" in ('active', 'nullified'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `badge_awards_attempt_id_unique` ON `badge_awards` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_award_one_active` ON `badge_awards` (`student_id`,`badge_id`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `badge_eligibilities` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`eligible_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`badge_id`) REFERENCES `track_badges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_eligibility_student_badge` ON `badge_eligibilities` (`student_id`,`badge_id`);--> statement-breakpoint
CREATE TABLE `badge_nullifications` (
	`id` text PRIMARY KEY NOT NULL,
	`award_id` text NOT NULL,
	`reason` text NOT NULL,
	`confirmed_by_id` text NOT NULL,
	`confirmed_by_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`award_id`) REFERENCES `badge_awards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `badge_nullifications_award_id_unique` ON `badge_nullifications` (`award_id`);--> statement-breakpoint
CREATE TABLE `badge_skill_requirements` (
	`badge_id` text NOT NULL,
	`skill_id` text NOT NULL,
	PRIMARY KEY(`badge_id`, `skill_id`),
	FOREIGN KEY (`badge_id`) REFERENCES `track_badges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interview_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`retake_available_at` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`badge_id`) REFERENCES `track_badges`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_attempt_status" CHECK("interview_attempts"."status" in ('awaiting_interview', 'awaiting_outcome', 'passed', 'failed', 'retake_later')),
	CONSTRAINT "ck_attempt_no" CHECK("interview_attempts"."attempt_no" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_attempt_number` ON `interview_attempts` (`student_id`,`badge_id`,`attempt_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_attempt_one_open` ON `interview_attempts` (`student_id`,`badge_id`) WHERE status in ('awaiting_interview', 'awaiting_outcome');--> statement-breakpoint
CREATE TABLE `interviewers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interviewers_email_unique` ON `interviewers` (`email`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_code_unique` ON `skills` (`code`);--> statement-breakpoint
CREATE TABLE `student_skill_completions` (
	`student_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`cleared_at` text NOT NULL,
	`source` text DEFAULT 'skill_contest' NOT NULL,
	PRIMARY KEY(`student_id`, `skill_id`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`cohort` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_email_unique` ON `students` (`email`);--> statement-breakpoint
CREATE TABLE `track_badges` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`track` text NOT NULL,
	`tier` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`interview_minutes` integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `track_badges_slug_unique` ON `track_badges` (`slug`);