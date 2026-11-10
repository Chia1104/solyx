---
type: fact
title: "Macro trimmed (PR #57), investor flows/籌碼 for the agent (#58), UI (#59) and chart panes (#61), all merged to develop 2026-10-09; macro values deferred; what is left unbuilt"
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

# Macro trimmed (PR #57), investor flows/籌碼 for the agent (#58), UI (#59) and chart panes (#61), all merged to develop 2026-10-09; macro values deferred; what is left unbuilt

On 2026-10-09 the user found the TW macro calendar of little use (it lists only release dates, no figures). Decided together:

- PR #57 (merged) `refactor/macro-market-movers`: drop `Unemployment` and revised `Gdp` from `MacroIndicator` / stat.gov.tw. No importance tiers added.
- All four merged to develop on 2026-10-09.
- PR #58 `feat/investor-flows` (unstacked, from develop): `@solyx/core/flows`, FinMind's free chip datasets, desktop `modules/flows` (keepFresh until 15:30/18:30/21:30 Taipei), agent `get_flows` in `@solyx/agent/flows`. Verified live without a token.
- PR #59 `feat/desktop-flows-view`, base `feat/investor-flows`: `flows` IPC module, a Flows/籌碼 view beside news and research for TW listings, and a 大盤籌碼 section on the overview. Retarget to develop after #58 merges ([[solyx-stacked-pr-merges]]).
- PR #61 `feat/desktop-flows-chart`, base `feat/desktop-flows-view`: chart indicators foreign-flow / trust-flow / margin as panes under TW D/W/M charts via a `panes` slot on PriceChart; `netBuyingByBar`/`balanceByBar` in core; flows lookback raised to a year. Not visually checked (throwaway identity has no Fugle key). A wallet-cluster bubble map (Bubblemaps style) was discussed and rejected: TW has no holder-level or transfer data; broker-branch data needs FinMind Sponsor.
- Macro figures with values (actual vs the agency's own next-month forecast range: MOEA export orders, MOF exports; NDC business-signal score) were deferred: the forecast ranges seem to exist only in press-release text, unverified as open data. FinMind's `TaiwanBusinessIndicator` is paid.

**Why:** the user agreed that 籌碼 are read daily and cost little (free FinMind), while macro values are monthly, mostly priced in by monthly revenue, and fragile to source.

**How to apply:** Not built yet: net buying as a share of volume; the CBC board-meeting dates (not on stat.gov.tw). Revisit macro values only after flows have been used. Related: [[solyx-calendar-sources]], [[solyx-scheduled-work]], [[solyx-commit-to-main]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-investor-flows.md`, type `project`).
