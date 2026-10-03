CREATE TABLE `news_source_health` (
	`source` text PRIMARY KEY,
	`last_success_at` integer,
	`last_failure_at` integer,
	`failure_streak` integer NOT NULL,
	`last_error` text
);
