-- Custom SQL migration file, put your code below! --
-- Each memory's words as `searchTerms` from @solyx/utils/search gives them, under the memory's rowid.
-- The repository writes the terms, since SQLite cannot split Chinese into words.
CREATE VIRTUAL TABLE `memory_terms` USING fts5(`terms`, content='', contentless_delete=1);
