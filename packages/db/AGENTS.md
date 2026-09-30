# `@solyx/db`

The app's SQLite databases: drizzle-orm schemas on the runtime's built-in `node:sqlite`, their drizzle-kit migrations, and the repositories other packages use.

## Boundaries

- Runs only in the main process; the renderer reaches data through IPC.
- One module and one file per database. `./cache` holds only what can be fetched again, so a file that is corrupt or holds a schema its migrations do not know is deleted and rebuilt. `./user` holds what the user made, such as the watchlist, trade proposals and conversations with the agent; it is never deleted, and its migration failures surface as errors.
- A database's tables live in `src/<database>-schema.ts`, and drizzle-kit generates `migrations/<database>/` from them through `drizzle.<database>.config.ts` (`db:generate`). Never edit a generated migration; a test fails when the migrations and the schema disagree.
- Callers pass the migrations folder, since the desktop bundle ships it beside `dist/main`.
- Repositories take and return domain types such as `Candle` and exchange-local dates, never drizzle rows or row ids. Policies about what to store belong to the caller: the candle cache's live in `@solyx/market-data/candle-cache`.
