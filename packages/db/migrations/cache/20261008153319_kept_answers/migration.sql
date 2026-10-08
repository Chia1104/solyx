CREATE TABLE `kept_answers` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`asked_at` integer NOT NULL,
	`answer` text NOT NULL,
	CONSTRAINT `kept_answers_pk` PRIMARY KEY(`scope`, `key`)
);
