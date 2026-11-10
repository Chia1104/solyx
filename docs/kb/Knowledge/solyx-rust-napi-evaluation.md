---
type: fact
title: 2026-10-24 measured whether a Rust/napi-rs backtest core pays off; advised against at daily scale, WASM first if ever
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-10
tags:
  - imported/claude-code
approved_at: 2026-11-10
approved_by: auto-approve
---

# 2026-10-24 measured whether a Rust/napi-rs backtest core pays off; advised against at daily scale, WASM first if ever

2026-10-24: the user asked whether to move backtest math to Rust via napi-rs (after studying blave-agent's MCPT, plateau scan and walk-forward). Measured on an M3 Pro, Node 26, synthetic bars:

- `backtest()` over 3,660 daily bars (the cap, 10 years × 366) takes 5.6 ms. Profile: ~50% Temporal date strings (mostly the equity curve's per-bar `candleDate`), ~17% `seriesKey` JSON.stringify per comparison per bar, indicators and rules <10%.
- MCPT with 2,000 permutations at 3,660 bars: JS 17 ms vs Rust 15 ms on one thread, 2.1 ms on 10. At 300k bars: JS 6.1 s, Rust 0.97 s on one thread, 0.15 s on 10. The first JS draft took 265 ms because `%` on a uint32 falls back to float modulo, so how the loop is written mattered more than the language.
- napi-rs conflicts with the root rule that the app ships no native modules, with source-only `@solyx/*` packages, and with core being pure and cross-runtime.

Advice given: fix the two TS hot spots first, then build MCPT, scans and walk-forward as Float64Array kernels on worker_threads, and use Rust only for intraday backtests, as WASM before napi-rs.

Later the same day the user said shipping native modules is acceptable. The root AGENTS.md line was not changed yet. My view then: packaging is cheap, since both installers build on native runners (macos-26 arm64 with no universal build, windows-2025 x64) and CI needs a Linux build for tests. The real costs are two:

- A `.node` must sit in `app.asar.unpacked`, outside the asar integrity fuse, and macOS turns library validation off. Loaded into the backend, which can ask the main process to decrypt secrets, an edited addon would run as the app.
- A native crash would take the OrderDesk down.

So, if built, run it in its own utility process with no host port, as Fubon's SDK runs. Keep every rule (ticks, costs, adjustments, conditions) in TS, which hands the kernel columns. Build it only when a heavy workload arrives.

2026-10-24: the user confirmed the design. They chose the name `@solyx/kernel` and folding the switch to the kernel into PR1. They also said to keep the enums napi generates, so `--no-const-enum` is not used; the current interface has no enums anyway. PR1 is #306 (`feat/kernel`), open.

- Core's tests pass unchanged on the kernel, and results are JSON-identical to the old engine at 3,660 and 300k bars.
- A packaged Solyx Test ran `backtest.rules` end to end, and only the kernel process maps `app.asar.unpacked`.
- Fubon and kernel processes share `UtilityKind` and `processes.open/kill`, and `processCalls` is shared too.
- No Rust unit tests: a test binary that links napi may not link on Linux.
- The `.d.ts` is built with `--no-dts-header`, since Fallow flagged napi's `eslint-disable` header.

PR2 is #307 (`feat/kernel-columns`), stacked on #306, opened 2026-10-24.

- `backtest.rules` takes a symbol, an interval and a since, and reads its own bars, so they never enter the VM.
- Intraday bars:
  - `since` reaches back 3 years; Fugle keeps minute bars from 2023-05-23, and each request covers under a year.
  - References come from the daily bars, applied only where a session went ex or split (`withSessionMoves`).
  - A minute is locked when it traded at one price at the limit; `twPriceLimits` works the limit out as 10% kept to the tick.
- The result shape changed: `entryTime`/`exitTime`, equity per session, and `interval`/`bars`.
- `tools.candles` still refuses `since` on intraday bars.
- 120 daily runs were identical to #306.
- The backtest skill changed but the eval was not rerun, since it spends the user's tokens; ask first.
- When #306 merges, retarget #307 to `develop`.

PR3 is #308 (`feat/kernel-validation`), stacked on #307, opened 2026-10-24. The user said to go ahead without the eval.

- Every stretch has a Sharpe ratio over session returns.
- A backtest's stretches have a p-value from 1000 seeded permutations of (overnight, intraday) bar moves, holding and costs kept.
- `backtest.scan` runs ≤400 strategies on shared lines (≤64 series), and `columns` makes a grid with a 3×3 neighbourhood-mean plateau and an edge flag.
- `backtest.walkForward` uses rolling windows (default train 2/5 of the sessions, test 1/4 of train), stitches the tests and reports efficiency.
- In the kernel: one `simulate` loop, and rayon. napi `dyn-symbols` is back on, so `cargo test` runs as `@solyx/kernel#test`.
- Parity with #307: 120 runs identical. A reordered subtraction in the sale was caught and fixed.
- Electron smoke used the unpackaged build with Fugle faked in the backend.
- The eval has still not been rerun.
- #308's first CI run failed: a backup test timed out because `cargo test` compiled beside the JS tests on the 4-core runner. The fix is to compile the kernel before `vp run -r test`, with `vp run @solyx/kernel#build` and `cargo test --no-run`. CI passed after that.

2026-10-25: I reviewed the user's real 3231 conversation on the dev build of #308.

- The agent used the new `backtest.rules` correctly. Every figure it cited matched the engine, it read the out-of-sample pValue correctly, and it gave the insider-trading reminder from the user's memory.
- It read only the default 2-year lookback (485 bars, 27 trades), since it never passed `since`.
- It called `tools.candles` only to work out the split day.
- It called data ending 2026-10-22 incomplete, but the market was closed on 10-23 for a typhoon. That is a known calendar limit: a closure called on the day is not known.
- I proposed making the skill default to about 10 years of daily bars and letting `split` take a fraction of the sessions.

2026-10-25: the user asked for the 3231 fixes and for the eval to read `EVAL_PROXY_BASE_URL` and `EVAL_PROXY_API_KEY`. That proxy serves Anthropic's API at `http://host` with no path. The fixes are on #308:

- `split` takes `{ day } | { share }`, parsed at the agent boundary from a date or a number, since the anti-slop rule forbids a runtime `typeof`.
- The skill passes `since` ten years back, and the history limit counts calendar years.
- A `since` before the limit now reads from the limit, because an agent's UTC `new Date()` landed a day short.
- Strategies and the backtest inputs are strict objects, since a misspelt stop was silently dropped and guessed keys such as `grid` looked accepted.
- The eval records scan cells, plateaus and walk-forwards, and has a `history` criterion.
- zod 4's `z.unknown()` key is required, which broke the eval's scan recording until it was made optional.

Eval results:

- Run 1: 59/61 tuned and 25/26 held out, with the harness bug.
- Run 2: 55/61 and 25/26.
- Run 3, after tightening the skill, with 2 repeats: 119/122 tuned (97.5%) and 51/52 held out (98.1%).
- In all, $6.93 was spent through the proxy.
- Failures left, one each: buy-and-hold's in-sample drawdown left out, a fallback pick made on out-of-sample, and in-sample stretches under 20 trades not flagged.

2026-10-25: the user said a span should depend on the rule, since short-term trading needs less. The skill now reads far enough for about 20 trades per stretch and a fall as well as a rise: about 10 years for weeks-long rules and 3–5 for rules that trade every few days. It reads further back when a stretch falls short, and the eval's `history` criterion judges by trades.

- Run 4, with 2 repeats: 117/122 tuned and 52/52 held out, $3.68. That is $10.61 spent on evals in all.
- No eval request is a span-less short-term rule, so the 3–5 year branch is untested.
- Agents pass very early `since` values, such as 1995, to mean as far as possible, which the clamp turns into ten years.

The design originally proposed: PR1 holds:

- `packages/kernel`, a Rust crate on napi-rs.
- The kernel's own utility process, with no host port.
- Core's `backtest()` made async over a `BacktestKernel` contract, with the TS loop deleted.
- The existing backtest tests kept as the parity proof.

PR2 is the large-data path and PR3 is MCPT, scans and walk-forward. Electron's MessagePortMain transfers only ports, so typed arrays are copied. oRPC's RPCSerializer has no typed arrays, so it needs custom handlers plus `experimental_transfer`; a spike verifies that first.

**Why:** the bottleneck is bookkeeping, not math, and at daily scale V8 is about as fast as native code.
**How to apply:** if Rust or native code comes up again, start from these numbers. Re-measure before building anything. Related: [[solyx-backtest-evaluation]], [[solyx-shioaji-roadmap-decisions]].

By 2026-10-25 the user had merged #306, #307 and #308 into develop.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-rust-napi-evaluation.md`, type `project`).
