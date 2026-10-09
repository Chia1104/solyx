CREATE TABLE `passage_vectors` (
	`space` text NOT NULL,
	`passage` text NOT NULL,
	`vector` blob NOT NULL,
	CONSTRAINT `passage_vectors_pk` PRIMARY KEY(`space`, `passage`)
);
