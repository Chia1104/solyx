CREATE TABLE `paper_fills` (
	`seq` integer PRIMARY KEY,
	`order_id` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` real NOT NULL,
	`filled_at` integer NOT NULL,
	`realized` real
);
