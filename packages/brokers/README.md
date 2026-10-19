# @solyx/brokers

Broker adapters, one module per broker:

- `@solyx/brokers/paper`: a paper broker. Orders fill immediately and in full, with no fees or transaction tax, and short selling is not supported.
- `@solyx/brokers/fubon`: the Fubon Neo API. `openFubonSession` loads the SDK, signs in with an API key and exchanges the session for market data tokens, which `@solyx/market-data/fubon` uses, and trades the stock account: holdings, what it can spend, orders and fills, and placing and cancelling orders.

## Why the Fubon SDK is not a dependency

`fubon-neo` is not published to npm. It is downloaded from Fubon's website, and its license does not clearly allow redistribution. It therefore stays out of the repository and the installer: each user downloads it, and the app loads it at runtime from the folder they choose. Only the SDK's native binding (`trade.js`) is loaded, since the package entry needs npm dependencies an extracted download lacks.

## What users do before using Fubon

1. Open a Fubon Securities account.
2. Sign the API usage agreement and pass the connection test.
3. Apply for a web certificate on Fubon's site and export it (`.pfx`); an exported certificate's password is the account's ID number unless the user sets another.
4. Create an API key on Fubon's API key page (SDK 2.2.7 or later). A key limited to market data cannot place orders.
5. Download the Node.js SDK (`fubon-neo-<version>.tgz`) from the [Fubon Neo API](https://www.fbs.com.tw/TradeAPI/) site, extract it, and choose that folder in the app.

## Checking against Fubon's test environment

Fubon runs a test environment with shared test accounts, open 9:30–19:00 Taipei time on weekdays. Download its package from the [Fubon Neo API](https://www.fbs.com.tw/TradeAPI/docs/welcome/) site, then read one of its accounts through this package:

```sh
vp exec node packages/brokers/scripts/fubon-test-env.ts <sdk folder> <test certificate .pfx> [--sell <code> <shares> <price>]
```

`--sell` places a limit sale of one of the test account's holdings, lists the day's orders and cancels it.

The test account's ID number is the certificate's file name, and its login and certificate password are the package's published `12345678`. Fubon's own guide says the test accounts' balances are not accurate and their holdings reset each day.
