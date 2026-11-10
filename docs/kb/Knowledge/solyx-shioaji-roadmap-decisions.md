---
type: fact
title: User's 2026-10-18 decisions on the 12-item roadmap from the Shioaji/TWSE study — market orders allowed, auto approval may skip per-order confirm, shioaji-data not used; build in order
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

# User's 2026-10-18 decisions on the 12-item roadmap from the Shioaji/TWSE study — market orders allowed, auto approval may skip per-order confirm, shioaji-data not used; build in order

On 2026-10-18 the user approved the 12-item roadmap in [[solyx-shioaji-reference]] and [[solyx-twse-openapi-gaps]] and asked me to build it in order (1 price limits into the desk → 2 failure split → 3 manual lock → broker orders/fills → 4 reconcile → 5 daily loss cap → 6 trade review → 7 price premise at confirm → 8 restriction kinds → 9 market cap → 10 sector drill-down → 11 governance risk → 12 backtest core).

Their decisions:

1. Market orders: allowed (sized against the session's limit-up price as the worst case). This lifts the 2026-10-07 deferral in [[solyx-deepen-modules-refactor]].
2. Conditional orders / brackets / auto trading: "設 auto 可以不用，除非是 ask" — under an `auto` approval setting an order needs no per-order confirm; under `ask` it does. This changes trading invariant 1 in the root AGENTS.md, so its scope (paper vs live, which approval setting, grants) still needs confirming before it is built; it is not one of the 12 items.
3. shioaji-data research layer: not now.

Progress (2026-10-18): stack #215 (price limits + market orders) → #216 (refused/unknown outcomes, `confirming` status) → #217 (order lock, `trading.locked`) → #218 (broker fills, `paper_fills`, daily loss cap, Trading settings tab) → #219 (trade review: `@solyx/core/review` round trips by entry stance) → #221 (proposal premise: session + price, MAX_PREMISE_MOVE 3%) → #222 (attention, near-disposition, altered-trading restrictions) → #223 (companies with shares: getCompanies replaces getIndustries) → #224 (sector movers from TWSE STOCK_DAY_ALL × shares, get_sector_movers) → #225 (governance records: pledges, FSC sanctions, exchange fines, control changes) → #226 (backtest: declared rules in `@solyx/core/backtest`, `backtest.rules` in run_analysis, /backtest skill; the user chose declared rules over per-bar scripts or a fill-only engine). All 11 stacked, each to retarget onto develop as its base merges. The user's review (PR comments on #218/#219/#221/#223/#226, 10 findings) was fixed on each branch and merged up the stack the same day: serialized confirmations, opening holdings in round trips, lock re-read before sending, float tolerance at 3%, TDR shares null, finished-session close, Company type, min-commission sizing, buy-and-hold boundary. Still open: auto-approval trading (decision 2) needs its scope confirmed before it is built. Solyx has no live broker (`./fubon` is sign-in and market data only), so the user chose to skip item 4 (reconcile unknown outcomes) until one exists, and build items 5–6 on fills the paper account records.

**How to apply:** follow the order; raise the auto-mode scope with the user before building it.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-shioaji-roadmap-decisions.md`, type `project`).
