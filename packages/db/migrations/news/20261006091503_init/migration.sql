CREATE TABLE `listing_news` (
	`item_id` integer NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`found_at` integer NOT NULL,
	`model` text,
	`relevance` real,
	`stance` text,
	`kind` text,
	`topic` text,
	CONSTRAINT `listing_news_pk` PRIMARY KEY(`item_id`, `market`, `symbol`),
	CONSTRAINT `fk_listing_news_item_id_news_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `news_items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `news_collections` (
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`collected_at` integer NOT NULL,
	CONSTRAINT `news_collections_pk` PRIMARY KEY(`market`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` integer PRIMARY KEY,
	`source` text NOT NULL,
	`channel` text NOT NULL,
	`key` text NOT NULL,
	`url` text,
	`title` text NOT NULL,
	`snippet` text NOT NULL,
	`site` text NOT NULL,
	`published_at` integer,
	`votes` integer,
	`published_precision` text,
	CONSTRAINT `news_items_source_key_unique` UNIQUE(`source`,`key`)
);
--> statement-breakpoint
CREATE TABLE `news_source_health` (
	`source` text PRIMARY KEY,
	`last_success_at` integer,
	`last_failure_at` integer,
	`failure_streak` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `listing_news_listing` ON `listing_news` (`market`,`symbol`);