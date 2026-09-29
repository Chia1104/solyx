CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	CONSTRAINT `watchlist_market_symbol_unique` UNIQUE(`market`,`symbol`)
);
