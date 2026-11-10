---
type: fact
title: 2026-10-20 inventory of Solyx data shown as text/tables that suits charts; which data is fetched but never rendered; what needs new storage
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

# 2026-10-20 inventory of Solyx data shown as text/tables that suits charts; which data is fetched but never rendered; what needs new storage

On 2026-10-20 the user asked which displays in Solyx could use more charts. A renderer inventory found the following; only suggestions, nothing has been built yet.

**Fetched but never drawn:**

- `ForecastRecord.calibration` buckets, which would make a reliability chart.
- `NewsReading.daily` (`SentimentDay[]`).
- `macro.series`: two years are fetched, but only the newest point is shown.
- `coverage.stances[]`: stance spells against the benchmark.
- `StatementMetrics` margins.

**Shown only as tables:**

- Market flows (`market-flows.tsx`, a year of daily data).
- Listing flows for dealers, short balance and foreign holding %.
- Sector movers' contribution.
- Trade review.
- `RoundTrip`s (`openedAt`/`closedAt`/`realized`), which allow a realized P&L curve. Individual trips are never listed.

**Only the agent sees:** backtest equity, base-rate move distributions, balance sheet, cash flow, dividends and ETF NAV/premium. The last four have no RPC.

**Needs new storage:** an equity curve, because no history of account value or cash is kept.

**Constraint:** charts must not use red or green except for price direction (renderer Design rule). Widened on 2026-10-21 (PR #258) to cover a released macro figure's move from its previous period too. See [[solyx-chart-d3-tooltips]].

Progress:

- The user approved all ten candidates in the mockup on 2026-10-20. They are built in three groups, by stars.
- Group 1 is PR #252: calibration beside the forecast strip, the realized trend in the P&L tab, and daily sentiment columns beside the gauge.
- Group 2 is PR #253, stacked on #252:
  - Market net buying stacked columns.
  - Macro sparklines.
  - Dealer, short and holding chart panes as new `ChartIndicator`s.
  - A stance-history strip of blocks; spells carry no daily path.
- Group 3 is PR #255, stacked on #253:
  - Contribution bars in the sector movers table.
  - A day-range bar in the quote board. The band is the next session's after the close, so the track also spans today's prices.
  - Margin lines in the financial trends.
- All ten candidates are built. Merge order: #252 → #253 → #255.
- Keyless data the throwaway identity reads for real: market flows, DGBAS series, FinMind listing flows and sector movers.
- The smoke kit's fake Fugle prices were moved to about 2,420. TWSE's real band (2,180–2,660) refuses proposals at 1,05x.

Related: [[solyx-trading-ui-plan]], [[solyx-reply-rendering]], [[solyx-investor-flows]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-chart-candidates.md`, type `project`).
