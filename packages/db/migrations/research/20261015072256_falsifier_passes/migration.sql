CREATE TABLE `falsifier_passes` (
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`revision` integer NOT NULL,
	`at` integer NOT NULL,
	`items` integer NOT NULL,
	`unread` integer NOT NULL,
	`failure` text,
	CONSTRAINT `falsifier_passes_pk` PRIMARY KEY(`market`, `symbol`)
);
