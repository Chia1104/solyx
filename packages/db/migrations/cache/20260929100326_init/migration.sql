CREATE TABLE `candle_series` (
	`id` integer PRIMARY KEY,
	`source` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`covered_from` text NOT NULL,
	`covered_to` text NOT NULL,
	CONSTRAINT `candle_series_source_market_symbol_interval_unique` UNIQUE(`source`,`market`,`symbol`,`interval`)
);
--> statement-breakpoint
CREATE TABLE `candles` (
	`series_id` integer NOT NULL,
	`time` integer NOT NULL,
	`date` text NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	CONSTRAINT `candles_pk` PRIMARY KEY(`series_id`, `time`),
	CONSTRAINT `fk_candles_series_id_candle_series_id_fk` FOREIGN KEY (`series_id`) REFERENCES `candle_series`(`id`) ON DELETE CASCADE
);
