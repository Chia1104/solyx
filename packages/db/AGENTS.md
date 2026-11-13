# `@solyx/db`

The app's SQLite databases: drizzle-orm schemas on the runtime's built-in `node:sqlite`, their drizzle-kit migrations, and the repositories other packages use.

## Boundaries

- One module and one file per database. Only `./cache` holds what can be fetched again, so only its file is deleted and rebuilt when it is corrupt or holds a schema its migrations do not know; every other database is never deleted, and its migration failures surface as errors.
  - `./cache`: candles, and the answers `keepFresh` readers keep, each as the JSON its reader wrote, dropped a week after it was asked for.
  - `./user`: what the user made, such as the watchlist, proposals, the paper account and its fills, scheduled tasks, watched themes and backtests.
  - `./news`: what news sources found for each listing, with its scores and vectors. Sources reach back only days, so its history cannot be fetched again; it is kept until its owner prunes a channel's items past the day it names.
  - `./memory`: what the agent keeps across conversations, which the user reads and edits.
  - `./research`: reports' revisions, forecasts as made with their outcomes, each written once, falsifier readings and passage vectors.
  - `./agent`: the agent's conversations in pi-durable's own schema, which pi-durable migrates as it opens the file. The module only opens it, compacts it and erases a conversation, which pi-durable cannot, and its SQL refuses any pi-durable schema version but the one it is written against.
- Vectors kept by text share one table shape and cache, `./vectors.ts`. A database keeps one space at a time, so keeping another space's vectors drops the ones it held.
- drizzle-kit generates `migrations/<database>/` from `src/<database>-schema.ts` (`db:generate`). Never edit a generated migration; a test fails when the migrations and the schema disagree. What drizzle cannot model, such as an FTS5 table, is a custom migration (`drizzle-kit generate --custom`).
- Full-text indexes hold the terms `searchTerms` from `@solyx/utils/search` gives, written in the transaction that changes their row, since SQLite cannot split Chinese into words; a query goes through the same function, so it matches as the app's in-memory search does. A database indexes the rows its index misses as it opens.
- Every database runs in WAL mode and syncs to disk at checkpoints, which a crash of the app never loses, but a power loss can take back its last commits. `./user` syncs every commit instead, since the order desk marks a proposal as sending before its order goes out and trusts that mark never to send it again.
- Callers pass the migrations folder, since the desktop bundle ships it beside `dist/main`.
- `./snapshot` copies an open database as it stands at one moment, which copying the file would not, since its newest writes are in the write-ahead log. It refuses to let a copy take a database's place when the copy is damaged or a newer build wrote it, which opening the file would not notice, since drizzle only runs the migrations a file lacks. A migration is known by its name, never by its hash, which covers line endings that differ between the macOS and Windows builds.
- Repositories take and return domain types such as `Candle` and exchange-local dates, never drizzle rows or row ids. Policies about what to store belong to the caller: the candle cache's live in `@solyx/market-data/candle-cache`, and how long news is kept in the desktop app.
