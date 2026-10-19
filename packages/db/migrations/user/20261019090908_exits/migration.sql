CREATE TABLE `paper_exit_legs` (
	`seq` integer PRIMARY KEY,
	`ref` text NOT NULL UNIQUE,
	`tag` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` integer NOT NULL,
	`leg` text NOT NULL,
	`price` real NOT NULL,
	`until` text NOT NULL,
	`placed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `proposals` ADD `exit` text;--> statement-breakpoint
ALTER TABLE `proposals` ADD `exit_refs` text;--> statement-breakpoint
ALTER TABLE `proposals` ADD `exit_ended` text;