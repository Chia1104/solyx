CREATE TABLE `forecasts` (
	`seq` integer PRIMARY KEY,
	`id` text NOT NULL UNIQUE,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`anchor_date` text NOT NULL,
	`forecast` text NOT NULL,
	`outcome` text,
	CONSTRAINT `forecasts_market_symbol_anchor_date_unique` UNIQUE(`market`,`symbol`,`anchor_date`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`revision` integer NOT NULL,
	`report` text NOT NULL,
	CONSTRAINT `reports_market_symbol_revision_unique` UNIQUE(`market`,`symbol`,`revision`)
);
