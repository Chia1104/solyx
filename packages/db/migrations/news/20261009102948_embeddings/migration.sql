CREATE TABLE `item_embeddings` (
	`item_id` integer PRIMARY KEY,
	`space` text NOT NULL,
	`vector` blob NOT NULL,
	CONSTRAINT `fk_item_embeddings_item_id_news_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `news_items`(`id`) ON DELETE CASCADE
);
