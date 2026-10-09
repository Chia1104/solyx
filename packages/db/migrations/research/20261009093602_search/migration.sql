-- Custom SQL migration file, put your code below! --
-- Each report revision's and each forecast's words as `searchTerms` from @solyx/utils/search gives
-- them, under the row's rowid. The repository writes the terms, since SQLite cannot split Chinese
-- into words, and indexes rows kept before these tables existed as the database opens.
CREATE VIRTUAL TABLE `report_terms` USING fts5(`terms`, content='', contentless_delete=1);
--> statement-breakpoint
CREATE VIRTUAL TABLE `forecast_terms` USING fts5(`terms`, content='', contentless_delete=1);
