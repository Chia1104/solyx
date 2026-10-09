# `@solyx/fundamentals`

Fundamentals providers, one module per provider, each implementing `FundamentalsProvider` from `@solyx/core/fundamentals`. `./finmind` reads Taiwan listings' quarterly income statements, monthly revenue, dividends and restrictions, who trades them and the market (`FlowsProvider` from `@solyx/core/flows`), and the days Taiwan's exchange trades (`TradingCalendarProvider` from `@solyx/core/session`), from FinMind's open API, which answers without a token under the lowest limit and with the user's token under the limit of the plan it belongs to (`FINMIND_PLANS`). The token and the plan are read for every request, so a saved one applies at once.

## Boundaries

- Runs only in the main process: modules make network requests.
- Parse every row with zod and normalize here: a statement holds one quarter's figures alone, in the market's currency, and a quarter without revenue is dropped. Flows count shares, not board lots, and the rows a provider splits one investor group into add up to one. A provider that gives no filing date stamps `knownFrom` with the market's filing deadline, so a past multiple never leans on results the market had not seen. A distribution that pays neither cash nor stock, such as a cash capital increase alone, is dropped.
- Call a provider's REST API through `ky` with an injectable `fetch`. A failure's message names the provider and the reason it gives.
- Each module keeps within its provider's request limit with `@solyx/utils/rate-limit`, so callers keep one instance.
- A dataset a provider keeps for paying members is asked for only on a plan that reads it and with a token, never to find out: FinMind answers a free token's request for one with a failure. Short-sale suspensions are free; day-trading suspensions, dispositions and halts need a paid plan. A row of another listing is dropped, since a dataset may answer for every listing at once.
- Tests use synthetic payloads shaped like the provider's responses; never commit recorded statements.
