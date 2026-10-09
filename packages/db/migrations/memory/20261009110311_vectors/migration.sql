CREATE TABLE `memory_vectors` (
	`space` text NOT NULL,
	`passage` text NOT NULL,
	`vector` blob NOT NULL,
	CONSTRAINT `memory_vectors_pk` PRIMARY KEY(`space`, `passage`)
);
