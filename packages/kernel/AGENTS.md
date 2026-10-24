# `@solyx/kernel`

The backtests' native core, in Rust on napi-rs: what a strategy's rules decide bar by bar and how each stretch went, over the columns `@solyx/core/backtest` prepares.

## Boundaries

- It holds no rule of a market. Ticks, slippage, costs, adjustments, limit locks, indicators and sessions are worked out in `@solyx/core` and handed over as columns and numbers, so the order panel, the risk checks and backtests read one set of rules. The kernel decides only what follows the path: the fills, the holding, stops, the equity curve and each stretch's figures.
- It reads typed arrays of one value a bar rather than objects, and does no I/O.
- `vp run @solyx/kernel#build` writes `src/solyx-kernel.node`, which `./kernel` loads from beside itself, and `src/index.d.ts`, napi's types for the Rust source as napi writes them. The types are committed, so the workspace type-checks without Rust; an exported type changes in the Rust source and then the build.
- An exported function fails with `napi::Result` and is marked `catch_unwind`, so a panic fails the call rather than the process.
- The app loads it only in a utility process of its own, which the backend calls over a port; tests load it in their own process.
