# `@solyx/brokers`

Brokers, one module per broker, each implementing `BrokerAdapter` from `@solyx/core/broker`. `./paper` is the paper broker; `./fubon` signs in to Fubon through the user's own SDK and exchanges the session for market data tokens.

## Boundaries

- `./fubon`'s session runs only in the utility process the desktop starts for it.
- A broker throws `OrderRefusedError` only where it surely holds nothing of the order; any other failure leaves the outcome unknown, and the desk never sends that order again.
- `./paper` keeps its account and every fill in a `PaperLedger`, which the app backs with `@solyx/db/user`, so both outlive the app as proposals do. It writes the account and the fill last, in one write, so an order it cannot fill, for want of cash, shares or a price, is refused.
- `./fubon` loads `fubon-neo` at runtime from the path the user chooses; it is never a dependency or bundled. It covers sign-in and market data tokens, not accounts or orders.
