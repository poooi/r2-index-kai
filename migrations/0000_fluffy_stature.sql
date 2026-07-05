CREATE TABLE `folders` (
	`bucket` text NOT NULL,
	`prefix` text NOT NULL,
	`parent_prefix` text,
	`name` text NOT NULL,
	`explicit_marker` integer DEFAULT 0 NOT NULL,
	`marker_seen_generation` integer DEFAULT 0 NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`total_file_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`modified_at` integer,
	`needs_recompute` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bucket`, `prefix`)
);
--> statement-breakpoint
CREATE INDEX `folders_by_parent` ON `folders` (`bucket`,`parent_prefix`,`name`);--> statement-breakpoint
CREATE INDEX `folders_needing_recompute` ON `folders` (`bucket`,`needs_recompute`);--> statement-breakpoint
CREATE TABLE `index_buckets` (
	`bucket` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`last_scan_started_at` integer,
	`last_scan_finished_at` integer,
	`last_event_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `index_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`kind` text NOT NULL,
	`generation` integer NOT NULL,
	`cursor` text,
	`status` text NOT NULL,
	`lease_expires_at` integer,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `index_runs_by_bucket_status` ON `index_runs` (`bucket`,`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `index_runs_by_bucket_generation_kind` ON `index_runs` (`bucket`,`generation`,`kind`);--> statement-breakpoint
CREATE TABLE `objects` (
	`bucket` text NOT NULL,
	`key` text NOT NULL,
	`parent_prefix` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_at` integer NOT NULL,
	`etag` text,
	`seen_generation` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bucket`, `key`)
);
--> statement-breakpoint
CREATE INDEX `objects_by_parent` ON `objects` (`bucket`,`parent_prefix`,`name`);--> statement-breakpoint
CREATE INDEX `objects_by_generation` ON `objects` (`bucket`,`seen_generation`,`updated_at`,`key`);