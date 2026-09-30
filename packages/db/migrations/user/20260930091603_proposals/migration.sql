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
