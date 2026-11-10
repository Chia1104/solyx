---
type: fact
title: 2026-10-18 study of Sinopac's shioaji-pro-app (AGPL, local clone) for ideas Solyx could borrow; which ones fit and which conflict with the invariants
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

# 2026-10-18 study of Sinopac's shioaji-pro-app (AGPL, local clone) for ideas Solyx could borrow; which ones fit and which conflict with the invariants

On 2026-10-18 the user had me study `/Users/chia1104/Documents/GitHub/shioaji-pro-app` (Shioaji Pro, AGPL-3.0, so concepts only, never code) for ideas. Nothing was built yet; the user had not picked any.

Ideas that fit Solyx, as I ranked them:

- Order outcome split: "refused before dispatch" vs "outcome unknown" (timeout/5xx/abort), unknown → one authoritative broker read, never resend. Solyx's `SubmissionFailureCode.Error` lumps both.
- Price premise at confirm: proposal shows live price vs proposed; stale or moved proposals need re-proposing (their agent approvals require an unchanged quote within 15 s; triggers hold for "restore confirmation" and need a "re-cross"). Solyx's desk still has no quote feed.
- Kill switch: manual lock + daily loss cap beside `maxOrderNotional`; fail closed while P&L is unknown (their bug: `dailyPnlKnown` never checked).
- A pure backtest core in `@solyx/core` that `run_analysis` scripts call: signal at close i fills at open i+1, look-ahead raises, TW fee/tax/slippage, in-sample vs out-of-sample, immutable revisions + run manifest.
- Trade review: P&L/win rate/payoff ratio grouped by `ProposalBasis` stance.
- Intraday signals (limit approach, rapid move, volume burst) as change kinds for task wakeups — Shioaji's server computes these; Solyx would need its own stream.
- Workflow observation: a daily read-only run turns repeated steps into skills, never overwriting a user-edited one.

Conflicts: their controlled-auto trading mode and client-side brackets/stop triggers fire orders without a per-order user confirm, against Solyx's trading invariant 1; would need the user's decision. Market pulse / index contribution depends on Shioaji server streams Solyx has no source for.

`Sinotrade/shioaji-data` (public repo created 2026-10-13, rebuilt every trading day by a private pipeline): the official half (prices, market cap, monthly revenue, IFRS statements) duplicates what Solyx already reads from primary sources. The useful half is the AI-curated research: ~5,100 relation edges (customer/supplier/competitor/partner/subsidiary, each with source URL and date but no quote text), 37 chains/themes with upstream/mid/downstream stages, a four-level industry taxonomy finer than the exchange's, and revenue segments; it covers 813 of 1,989 companies. Its license is "待定" (to be decided), so it is blocked until Sinotrade sets one. If it is ever used, treat edges as leads the agent quotes from the source, not as claims.

Consolidated with [[solyx-twse-openapi-gaps]] on 2026-10-18. `BrokerAdapter` only has `getAccount` and `placeOrder`, so reading the broker's orders and fills is a shared prerequisite for reconciling unknown outcomes, a daily loss cap and the trade review. Proposed order: price limits into the desk, then the failure split and a manual lock, then the broker's orders/fills, then the restriction kinds and market cap; the backtest core and intraday signals come last.

Related: [[solyx-workflow-review]], [[solyx-research-forecast-design]], [[solyx-deepen-modules-refactor]]

**Second study, 2026-10-30 (Shioaji Pro v0.1.52–v0.1.56, data organization and presentation):** filed in Linear as parent CHI-48 with sub-issues, all Backlog and none committed: CHI-49 per-panel as-of/source marks + "—" with reason (P3), CHI-50 volume ratio + intraday range rail on the listing's quote (P3), CHI-51 watchlist limit marks + optional columns (P3), CHI-52 privacy mode incl. agent replies (P3), CHI-53 holdings by sector/theme vs the day's flows (P3), CHI-54 sector heat map drill-down + PNG export (P3), CHI-55 TW breadth + turnover vs previous session (P4), CHI-56 company view with sources (P4, US via Longbridge first), CHI-57 backend start failures by cause + redacted diagnostics (P4). Suggested order 49 → 50 → 52 → 53 → 54. Left out: chain money flow (~800 live 1-minute bars exceed Fugle's basic plan; shioaji-data license still 待定), layout library/link groups/popouts (rejected 2026-10-19), status-colour fix (renderer already keeps red/green for direction only). Fugle `snapshot/quotes|movers|actives` are 開發者/進階 only (Basic ✘, docs 2026-10-30); Fubon serves them after sign-in at 300/min; rows have no reference or limit prices (breadth via `twPriceLimits(close − change)`); details in CHI-55. Probed 2026-10-30 through Fubon's test env (scripts kept in /tmp/solyx-snapshot-probe/script; the shared test account's market data token reads Fugle's production API with real data): one unpaged call per market, `change` = vs `referencePrice`, `lastUpdated` in µs, an untyped call also returns every index incl. all TWSE and TPEx sector indices. Unverified: which Longbridge company endpoints `@solyx/longbridge` reads, whether Fugle `intraday/quote` carries limit flags.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-shioaji-reference.md`, type `project`).
