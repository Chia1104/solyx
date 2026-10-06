CREATE TABLE `memories` (
	`id` integer PRIMARY KEY,
	`key` text NOT NULL UNIQUE,
	`kind` text NOT NULL,
	`market` text,
	`symbol` text,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`source` text
);
