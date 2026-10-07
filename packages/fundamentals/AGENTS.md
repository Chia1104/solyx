# `@solyx/fundamentals`

Fundamentals providers, one module per provider, each implementing `FundamentalsProvider` from `@solyx/core/fundamentals`. `./finmind` reads Taiwan listings' quarterly income statements and monthly revenue from FinMind's open API, which answers without a token under a lower limit and with the user's token under a higher one; the token is read for every request, so a saved one applies at once.

## Boundaries

- Runs only in the main process: modules make network requests.
- Parse every row with zod and normalize here: a statement holds one quarter's figures alone, in the market's currency, and a quarter without revenue is dropped. A provider that gives no filing date stamps `knownFrom` with the market's filing deadline, so a past multiple never leans on results the market had not seen.
- Call a provider's REST API through `ky` with an injectable `fetch`. A failure's message names the provider and the reason it gives.
- Each module keeps within its provider's request limit with `@solyx/utils/rate-limit`, so callers keep one instance.
- Tests use synthetic payloads shaped like the provider's responses; never commit recorded statements.
