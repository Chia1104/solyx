CREATE TABLE `news_collections` (
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`collected_at` integer NOT NULL,
	CONSTRAINT `news_collections_pk` PRIMARY KEY(`market`, `symbol`)
);
