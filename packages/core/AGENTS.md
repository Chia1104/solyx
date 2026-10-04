# `@solyx/core`

The trading domain every other package builds on: market rules (tick sizes, board and odd lots, trading sessions), candles and technical indicators, the `BrokerAdapter`, `MarketDataProvider`, `MarketDataStream`, `NewsSource` and `SentimentScorer` contracts, the `checkOrder` risk checks and the `OrderDesk` order flow.

## Boundaries

- Pure and cross-runtime: no I/O and no Node or DOM APIs, so every process imports it. Implementations of its contracts live in their own packages.
- Technical indicators are pure functions, one value per bar and `null` while warming up, so the charts and the agent read the same numbers.
- `./news` derives stories and sentiment from stored records as pure functions, so the symbol page's gauge and the agent read the same numbers. Items of one channel whose titles match exactly, such as reprints and a thread's replies, form one story; sentiment is given overall and for the press and the crowd.
