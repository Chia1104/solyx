# `@solyx/db`

The app's SQLite databases: drizzle-orm schemas on the runtime's built-in `node:sqlite`, their drizzle-kit migrations, and the repositories other packages use.

## Boundaries

- One module and one file per database. Only `./cache` holds what can be fetched again, so only its file is deleted and rebuilt when it is corrupt or holds a schema its migrations do not know; every other database is never deleted, and its migration failures surface as errors.
  - `./cache`: candles, and the answers `keepFresh` readers keep, each under its scope as the JSON its reader wrote and dropped a week after it was asked for.
  - `./user`: what the user made, such as the watchlist, trade proposals, the paper account, their scheduled tasks, each with its last run, and the themes they have the app watch, each with the news its searches found and how each item read against its signposts.
  - `./news`: what news sources found for each listing, the decisions model's scores and each item's vector. Sources reach back only days, so its history cannot be fetched again.
  - `./memory`: what the agent keeps across conversations, each memory saved once the user allowed it, and the vectors of their texts.
  - `./research`: every revision of each listing's report, every forecast as it was made with its outcome, which is written once, each reading of a falsifier against a news item, kept once, and each passage's vector by its text.
  - `./agent`: the agent's conversations, which are the user's too, in pi-durable's own schema. pi-durable migrates the file as it opens it, and the module only opens it, compacts it and erases a conversation, which pi-durable cannot. Its SQL is written against one pi-durable schema version and refuses any other.
- Vectors kept by text share one table shape and cache, `./vectors.ts`. A database keeps one space at a time, so keeping another space's vectors drops the ones it held.
- A drizzle database's tables live in `src/<database>-schema.ts`, and drizzle-kit generates `migrations/<database>/` from them through `drizzle.<database>.config.ts` (`db:generate`). Never edit a generated migration; a test fails when the migrations and the schema disagree. What drizzle cannot model, such as an FTS5 table, is a custom migration (`drizzle-kit generate --custom`).
- Full-text indexes hold the terms `searchTerms` from `@solyx/utils/search` gives, which the repository writes in the transaction that changes their row, since SQLite cannot split Chinese into words; a query goes through the same function, so it matches as the app's in-memory search does. A database indexes the rows its index misses, such as those kept before the index existed, as it opens.
- Callers pass the migrations folder, since the desktop bundle ships it beside `dist/main`.
- Repositories take and return domain types such as `Candle` and exchange-local dates, never drizzle rows or row ids. Policies about what to store belong to the caller: the candle cache's live in `@solyx/market-data/candle-cache`.
