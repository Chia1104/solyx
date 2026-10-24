CREATE TABLE `backtest_runs` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL UNIQUE,
	`ran_at` integer NOT NULL,
	`request` text NOT NULL,
	`headline` text
);
