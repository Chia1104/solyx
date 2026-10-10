CREATE TABLE `theme_items` (
	`id` integer PRIMARY KEY,
	`theme_id` text NOT NULL,
	`key` text NOT NULL,
	`url` text,
	`title` text NOT NULL,
	`snippet` text NOT NULL,
	`site` text NOT NULL,
	`published_at` integer,
	`published_precision` text,
	`found_at` integer NOT NULL,
	CONSTRAINT `fk_theme_items_theme_id_themes_id_fk` FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `theme_items_theme_id_key_unique` UNIQUE(`theme_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `theme_readings` (
	`id` integer PRIMARY KEY,
	`theme_id` text NOT NULL,
	`signpost` text NOT NULL,
	`item_key` text NOT NULL,
	`model` text NOT NULL,
	`supported` real NOT NULL,
	`checked_at` integer NOT NULL,
	CONSTRAINT `fk_theme_readings_theme_id_themes_id_fk` FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `theme_readings_theme_id_signpost_item_key_unique` UNIQUE(`theme_id`,`signpost`,`item_key`)
);
--> statement-breakpoint
CREATE TABLE `themes` (
	`seq` integer PRIMARY KEY,
	`id` text NOT NULL UNIQUE,
	`theme` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`collected_at` integer
);
