# `@solyx/kernel`

The backtests' native core, in Rust on napi-rs: what a strategy's rules decide bar by bar and how each stretch went, over the columns `@solyx/core/backtest` prepares.

## Boundaries

- It holds no rule of a market. Ticks, slippage, costs, adjustments, limit locks, indicators and sessions are worked out in `@solyx/core` and handed over as columns and numbers, so the order panel, the risk checks and backtests read one set of rules. The kernel decides only what follows the path: the fills, the holding, stops, the equity curve and each stretch's figures, which it also runs for many strategies at once over one set of bars, as a scan and as a walk forward, for one strategy over many windows of them, and tests by ordering the bars at random.
- Every run starts holding nothing at its first bar and walks one loop, `simulate`, whatever it serves, so a scan's cell, a walk forward's test, a rolling window and a single backtest fill alike. A rolling window's run starts at the bar before the window, so its rules are read from the close its figures are measured from. A permutation test reorders each bar's two moves, close to open and open to close, keeps the holding and the costs of the run, and is seeded, so it answers the same each time.
- It reads typed arrays of one value a bar rather than objects, and does no I/O.
- `vp run @solyx/kernel#build` writes `src/solyx-kernel.node`, which `./kernel` loads from beside itself, and `src/index.d.ts`, napi's types for the Rust source as napi writes them. The types are committed, so the workspace type-checks without Rust; an exported type changes in the Rust source and then the build.
- An exported function fails with `napi::Result` and is marked `catch_unwind`, so a panic fails the call rather than the process. `vp run @solyx/kernel#test` runs the crate's own tests, which napi's dynamic symbols let link without Node.
- The app loads it only in a utility process of its own, which the backend calls over a port; tests load it in their own process.
