# `@solyx/market-data`

Market data providers, one module per provider, each implementing `MarketDataProvider` from `@solyx/core/market-data`.

## Boundaries

- Runs only in the main process: modules hold API keys and make network requests.
- Parse every response with zod here and normalize units here: `Candle.volume` is shares and `Candle.time` is UTC seconds, with daily and longer bars at midnight exchange time.
- HTTP goes through `ky`; streaming uses the runtime's `WebSocket`. Call a provider's REST or WebSocket API directly instead of adding its SDK when the surface is small.
- `./fugle` covers Taiwan listings. Its history stops at the last close, so today's session comes from the intraday endpoint, and ranges of a year or more are split. Fugle clips weekly and monthly bars to the requested range, so those are merged from daily bars with `resampleDaily` instead.
- Tests use synthetic payloads shaped like the provider's responses; never commit recorded market data.
