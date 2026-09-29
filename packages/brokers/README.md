# @solyx/brokers

Broker adapters, one module per broker:

- `@solyx/brokers/paper`: a paper broker. Orders fill immediately and in full, with no fees or transaction tax, and short selling is not supported.
- `@solyx/brokers/fubon`: the Fubon Neo API. `openFubonSession` loads the SDK, signs in with an API key and exchanges the session for market data tokens, which `@solyx/market-data/fubon` uses. The broker adapter's account queries, order placement and cancellation wait until the SDK's responses are verified in Fubon's test environment.

## Why the Fubon SDK is not a dependency

`fubon-neo` is not published to npm. It is downloaded from Fubon's website, and its license does not clearly allow redistribution. It therefore stays out of the repository and the installer: each user downloads it, and the app loads it at runtime from the folder they choose. Only the SDK's native binding (`trade.js`) is loaded, since the package entry needs npm dependencies an extracted download lacks.

## What users do before using Fubon

1. Open a Fubon Securities account.
2. Sign the API usage agreement and pass the connection test.
3. Apply for a web certificate on Fubon's site and export it (`.pfx`); an exported certificate's password is the account's ID number unless the user sets another.
4. Create an API key on Fubon's API key page (SDK 2.2.7 or later). A key limited to market data cannot place orders.
5. Download the Node.js SDK (`fubon-neo-<version>.tgz`) from the [Fubon Neo API](https://www.fbs.com.tw/TradeAPI/) site, extract it, and choose that folder in the app.
