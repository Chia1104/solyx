-- Custom SQL migration file, put your code below! --
-- Each item's title and snippet as `searchTerms` from @solyx/utils/search gives them, under the
-- item's rowid. The repository writes the terms, since SQLite cannot split Chinese into words, and
-- indexes items kept before this table existed as the database opens.
CREATE VIRTUAL TABLE `news_terms` USING fts5(`terms`, content='', contentless_delete=1);
