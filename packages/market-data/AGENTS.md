# `@solyx/market-data`

Market data providers, one module per provider, each implementing `MarketDataProvider` from `@solyx/core/market-data`, and `./candle-cache`, which wraps any provider with the candle store from `@solyx/db/cache`.

## Boundaries

- Runs only in the main process: modules hold API keys and make network requests.
- Parse every response with zod here and normalize units here: `Candle.volume` is shares and `Candle.time` is UTC seconds, with daily and longer bars at midnight exchange time.
- HTTP goes through `ky`; streaming uses the runtime's `WebSocket`. Call a provider's REST or WebSocket API directly instead of adding its SDK when the surface is small.
- `./fugle` and `./fubon` both call Fugle's market data API through `fugle-api.ts`: Fubon serves the same API under its own session tokens, so the two differ only in endpoints, credentials and plan. `./fubon` takes its token and endpoints from a `@solyx/brokers/fubon` session rather than loading the SDK itself, and streams from the Normal-mode endpoint, the only one with candles.
- Fugle's API covers Taiwan listings. Its history stops at the last close, so today's session comes from the intraday endpoint, and ranges of a year or more are split. Providers serve bars of a session or shorter: Fugle clips weekly and monthly bars to the requested range, so the main process's market data module merges them from daily bars, for history and the live bar alike. It answers 404 for a range without sessions as well as for an unknown symbol, so a 404 empties only that request.
- The API also streams minute bars over one WebSocket; Fugle's basic plan allows one connection and five subscriptions, one per symbol. Subscribing returns the session so far as a snapshot, which also refills it after a reconnect, so subscriptions are kept as the set of watched symbols rather than queued commands. The server sends a heartbeat every 30 seconds, and refused credentials stop reconnecting.
- `./candle-cache` stores closed sessions only, since today's bars change until the close. Each series covers one contiguous date span that ends at its newest stored bar, so later days (holidays, or a session not yet published) are asked for again; a request past the span starts the series over. Intraday series keep the requested window, or the furthest back a request reached since the app started, so history a chart scrolled back to is not asked for again while it runs.
- Each provider module publishes its plans as `MarketDataPlan`s and takes the user's plan. Its REST budgets are enforced per instance with `@solyx/utils/rate-limit`, so callers keep one instance per credential and plan, and its stream takes as many symbols as the plan allows. A 429 retries for at most 10 seconds a time instead of hanging a chart.
- Tests use synthetic payloads shaped like the provider's responses; never commit recorded market data.
