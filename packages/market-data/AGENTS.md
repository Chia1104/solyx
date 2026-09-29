# `@solyx/market-data`

Market data providers, one module per provider, each implementing `MarketDataProvider` from `@solyx/core/market-data`, and `./candle-cache`, which wraps any provider with the candle store from `@solyx/db/cache`.

## Boundaries

- Runs only in the main process: modules hold API keys and make network requests.
- Parse every response with zod here and normalize units here: `Candle.volume` is shares and `Candle.time` is UTC seconds, with daily and longer bars at midnight exchange time.
- HTTP goes through `ky`; streaming uses the runtime's `WebSocket`. Call a provider's REST or WebSocket API directly instead of adding its SDK when the surface is small.
- `./fugle` covers Taiwan listings. Its history stops at the last close, so today's session comes from the intraday endpoint, and ranges of a year or more are split. Fugle clips weekly and monthly bars to the requested range, so those are merged from daily bars with `resampleDaily` instead. It answers 404 for a range without sessions as well as for an unknown symbol, so a 404 empties only that request.
- `./fugle` also streams minute bars over one WebSocket; the basic plan allows one connection and five subscriptions, one per symbol. Subscribing returns the session so far as a snapshot, which also refills it after a reconnect, so subscriptions are kept as the set of watched symbols rather than queued commands. Fugle sends a heartbeat every 30 seconds, and a refused key stops reconnecting.
- `./candle-cache` stores closed sessions only, since today's bars change until the close. Each series covers one contiguous date span that ends at its newest stored bar, so later days (holidays, or a session not yet published) are asked for again; a request past the span starts the series over. Weekly and monthly bars are merged from cached daily bars, and intraday series keep only the requested window.
- Each provider module publishes its plans as `MarketDataPlan`s and takes the user's plan. Its REST budgets are enforced per instance with `@solyx/utils/rate-limit`, so callers keep one instance per key and plan, and its stream takes as many symbols as the plan allows. A 429 retries for at most 10 seconds a time instead of hanging a chart.
- Tests use synthetic payloads shaped like the provider's responses; never commit recorded market data.
