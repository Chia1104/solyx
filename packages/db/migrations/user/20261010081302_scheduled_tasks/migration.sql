CREATE TABLE `scheduled_tasks` (
	`seq` integer PRIMARY KEY,
	`id` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`time_zone` text NOT NULL,
	`locale` text NOT NULL,
	`approval` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_run` text
);
