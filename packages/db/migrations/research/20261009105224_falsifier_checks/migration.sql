CREATE TABLE `falsifier_checks` (
	`id` integer PRIMARY KEY,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`revision` integer NOT NULL,
	`falsifier` text NOT NULL,
	`source` text NOT NULL,
	`item_key` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`site` text NOT NULL,
	`published_at` integer,
	`published_precision` text,
	`model` text NOT NULL,
	`supported` real NOT NULL,
	`checked_at` integer NOT NULL,
	CONSTRAINT `falsifier_checks_market_symbol_revision_falsifier_source_item_key_unique` UNIQUE(`market`,`symbol`,`revision`,`falsifier`,`source`,`item_key`)
);
