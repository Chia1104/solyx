CREATE TABLE `agent_messages` (
	`seq` integer PRIMARY KEY,
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`message` text NOT NULL,
	CONSTRAINT `fk_agent_messages_session_id_agent_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `agent_messages_session_id_id_unique` UNIQUE(`session_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`seq` integer PRIMARY KEY,
	`id` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
