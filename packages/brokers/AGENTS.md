# `@solyx/brokers`

Brokers, one module per broker, each implementing `BrokerAdapter` from `@solyx/core/broker`. `./paper` is the paper broker; `./fubon` signs in to Fubon through the user's own SDK and exchanges the session for market data tokens.

## Boundaries

- `./fubon`'s session runs only in the utility process the desktop starts for it.
- `./paper` keeps its account in a `PaperLedger`, which the app backs with `@solyx/db/user`, so the account outlives the app as proposals do.
- `./fubon` loads `fubon-neo` at runtime from the path the user chooses; it is never a dependency or bundled. It covers sign-in and market data tokens, not accounts or orders.
