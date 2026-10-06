# `@solyx/db`

The app's SQLite databases: drizzle-orm schemas on the runtime's built-in `node:sqlite`, their drizzle-kit migrations, and the repositories other packages use.

## Boundaries

- Runs only in the main process; the renderer reaches data through IPC.
- One module and one file per database. `./cache` holds only what can be fetched again, so a file that is corrupt or holds a schema its migrations do not know is deleted and rebuilt. `./user` holds what the user made, such as the watchlist, trade proposals and the paper account; it is never deleted, and its migration failures surface as errors. `./news` holds what news sources found for each listing and the decisions model's scores; sources reach back only days, so its history cannot be fetched again and it is kept like `./user`. `./memory` holds what the agent keeps across conversations, each memory saved once the user allowed it, and is kept like `./user`. `./agent` holds the agent's conversations, which are the user's too, in pi-durable's own schema; pi-durable migrates the file as it opens it, and the module only opens it, compacts it and erases a conversation, which pi-durable cannot. Its SQL is written against one pi-durable schema version and refuses any other.
- A drizzle database's tables live in `src/<database>-schema.ts`, and drizzle-kit generates `migrations/<database>/` from them through `drizzle.<database>.config.ts` (`db:generate`). Never edit a generated migration; a test fails when the migrations and the schema disagree. What drizzle cannot model, such as an FTS5 table, is a custom migration (`drizzle-kit generate --custom`).
- Full-text indexes hold the terms `searchTerms` from `@solyx/utils/search` gives, which the repository writes in the transaction that changes their row, since SQLite cannot split Chinese into words; a query goes through the same function, so it matches as the app's in-memory search does.
- Callers pass the migrations folder, since the desktop bundle ships it beside `dist/main`.
- Repositories take and return domain types such as `Candle` and exchange-local dates, never drizzle rows or row ids. Policies about what to store belong to the caller: the candle cache's live in `@solyx/market-data/candle-cache`.
