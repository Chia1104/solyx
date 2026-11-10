---
type: fact
title: "Backtest panel without the agent (2026-10-25): user's decisions, the 5-PR stack #310→#314 as built, what is unverified"
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

# Backtest panel without the agent (2026-10-25): user's decisions, the 5-PR stack #310→#314 as built, what is unverified

2026-10-25: the user asked how to let users run deep backtests directly, with commands and buttons, without going through the agent. My design: one engine, two entrances. A 回測 tab under the symbol chart runs backtests directly, and the agent keeps natural-language rules and interpretation. Rules are data, so a strategy can move between the two.

The user's decisions:

1. Build all seven templates: MA cross, RSI rebound, Bollinger breakout and reversion, MACD cross, KD cross, channel breakout. Each may add a stop loss and a take profit.
2. The scan heat map hides out-of-sample by default; it shows only for the picked cell, behind a switch.
3. Keep a history list of runs and allow comparing them.
4. Paired browsers may run backtests (`forDevices(true)`).

The stack was built the same day. Each PR is stacked on the one before, and all are unmerged:

1. #310 `feat/backtests-api`: core `./strategy-templates` (templates, `gridProblem`, `axisValues` that counts before it allocates), `backtestBars`, history limits in core/candles, the `backtests.*` API, and one kernel shared with the agent. A walk forward runs 100 windows at most. These caps came from a security review.
2. #311 `feat/backtest-panel`: the run report, holding's curve in core, chart marks, and `backtestBars` trimming to `since`. Before that trim, a one-year run read two years.
3. #312 `feat/backtest-scan-panel`: the mode switch, grid fields, heat map, walk-forward timeline, and the walk forward's holding and capital.
4. #313 `feat/backtest-history`: the `backtest_runs` table in user.sqlite, one row per request, the newest 200 kept; `compare` reruns without recording.
5. #314 `feat/backtest-agent-bridge`: a "backtest panel: backtest.rules(...)" context line with a prompt rule, `run_analysis` details keeping `backtests`, open-in-panel at the nearest years and split, and `useAgentDraft`.

Commands: keep the single `/backtest` skill. Add no `/scan` or `/walk-forward` skills, and no app command named `backtest`.

Not done: the backtest eval was not rerun after #314's prompt rule. Ask before running it, since it spends tokens. Smoke runs used faked Fugle bars and a fake Anthropic endpoint, and never a real model or real data.

Related: [[solyx-rust-napi-evaluation]], [[solyx-backtest-evaluation]], [[solyx-composer-commands]], [[solyx-isolated-smoke-run]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-backtest-panel.md`, type `project`).
