---
type: fact
title: "Rolling windows (滾動區間), built 2026-10-25 as stack #321 → #322 → #323: what the user's 滾動回測 meant, the decisions, what is unverified"
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

# Rolling windows (滾動區間), built 2026-10-25 as stack #321 → #322 → #323: what the user's 滾動回測 meant, the decisions, what is unverified

2026-10-25: the user asked how to design 滾動回測. Walk forward (前進分析, #308/#312) already existed, so I took the other meaning: one fixed strategy run from many starts, each window starting flat, to see how much a record owes to its start. The user accepted every recommendation ("先照你建議的方向做吧"):

- Windows in calendar months, not sessions (walk forward uses sessions). The first window starts in the first whole month, and only whole windows run.
- History headline per mode: `BacktestHeadline = BacktestMetrics | RollingSummary`. The column is JSON, so no migration.
- A grid × rolling version (each scan cell's share of starts that beat holding) is left for later. Walk forward already scores every cell per training window in `walk.rs` and throws the scores away.

Built as a stack, each PR on the one before. All were open and unmerged on 2026-10-25, fixes merged up the stack rather than rebased:

1. #321 `feat/rolling-backtests`: kernel `rolling` and core `rollingBacktest` with a summary (beatHolding, gained, p10/median/p90 spreads, worstDrawdown, thin, apart), and `ENOUGH_TRADES` exported.
   - Each window's run starts at the bar before it, so its rules read the close it is measured from.
   - The test "always holding returns what holding does" is the one that catches that off-by-one.
2. #322 `feat/rolling-panel`: API `backtests.rolling`, the backend service, and the panel's fourth mode with its report, history and i18n.
3. #323 `feat/rolling-agent`: script function `backtest.rolling`, skill step 10, and the eval recording rolling runs plus a `start-luck` request.

Defaults: 36-month windows, starting every month. With 10 years of data that gives about 84 windows that stand for about 3 periods apart.

Eval, run the same day at the user's go-ahead (2 repeats, Opus 5.5):

- The full run cost $4.91. The old tuned requests scored 121/122, up from 117/122. The held-out ones scored 52/52.
- The new `start-luck` request scored 20/26. The agent read the spread's `low`/`high` as the worst and best windows and left `apart` out once.
- Fixes: the fields became `p10`/`p90`, merged up the stack from #321, and skill step 10 was sharpened.
- `start-luck` alone, run again: 26/26, $0.71.

Docs: PR #325 (`docs/website-rolling`) is stacked on #323.

- It adds sections to `backtests` and `data/backtests`, in both locales.
- Four `backtests/rolling` shots were uploaded to R2 and verified.

Not seen: real Fugle bars, since the shots and the smoke run used the docs kit's faked ones.

Related: [[solyx-backtest-panel]], [[solyx-rust-napi-evaluation]], [[solyx-backtest-evaluation]], [[solyx-stacked-pr-merges]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-rolling-backtests.md`, type `project`).
