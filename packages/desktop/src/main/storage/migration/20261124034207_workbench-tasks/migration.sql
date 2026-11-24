CREATE TABLE `workbench_event` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workbench_run` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`stage` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE TABLE `workbench_task` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`serial` text NOT NULL,
	`title` text NOT NULL,
	`space_id` text NOT NULL,
	`space_name` text NOT NULL,
	`url` text,
	`directory` text NOT NULL,
	`branch` text,
	`stage` text NOT NULL,
	`plan_dir` text NOT NULL,
	`plan_version` integer DEFAULT 0 NOT NULL,
	`active_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workbench_event_task_idx` ON `workbench_event` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workbench_run_task_idx` ON `workbench_run` (`task_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workbench_task_item_directory_idx` ON `workbench_task` (`item_id`,`directory`);