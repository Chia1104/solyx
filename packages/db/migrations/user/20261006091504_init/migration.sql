CREATE TABLE `paper_account` (
	`id` integer PRIMARY KEY,
	`cash` text NOT NULL,
	`positions` text NOT NULL,
	`orders` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`seq` integer PRIMARY KEY,
	`id` text NOT NULL UNIQUE,
	`order_request` text NOT NULL,
	`source` text NOT NULL,
	`rationale` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`violations` text NOT NULL,
	`broker_order_id` text,
	`failure` text
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `watchlist_market_symbol_unique` UNIQUE(`market`,`symbol`)
);
