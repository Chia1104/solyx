# @solyx/brokers

Broker adapters, one module per broker:

- `@solyx/brokers/paper`: a paper broker. Orders fill immediately and in full, with no fees or transaction tax, and short selling is not supported.
- `@solyx/brokers/fubon`: the Taiwan stock adapter for the Fubon Neo API. It currently loads the SDK and logs in; account queries, order placement and cancellation wait until the SDK's responses are verified in Fubon's test environment.

## Why the Fubon SDK is not a dependency

`fubon-neo` is not published to npm. It is downloaded from Fubon's website, and its license does not clearly allow redistribution. It therefore stays out of the repository and the installer: each user downloads it, and the app loads it at runtime from the folder they choose (`loadFubonSdk`).

## What users do before using Fubon

1. Open a Fubon Securities account.
2. Apply for an electronic trading certificate (`.pfx`).
3. Sign the API usage agreement and pass the connection test.
4. Download the Node.js SDK (`fubon-neo-<version>.tgz`) from the [Fubon Neo API](https://www.fbs.com.tw/TradeAPI/) site, extract it, and choose that folder in the app.
