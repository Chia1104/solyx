---
type: fact
title: "Agent autonomy work (2026-10-11) — #91–#95 merged (fundamentals, memory unasked in auto, save_task, change_watchlist); #98, #99 open (flaky tests); the user's decisions, what is left"
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-11
tags:
  - imported/claude-code
approved_at: 2026-11-10
approved_by: auto-approve
---

# Agent autonomy work (2026-10-11) — #91–#95 merged (fundamentals, memory unasked in auto, save_task, change_watchlist); #98, #99 open (flaky tests); the user's decisions, what is left

On 2026-10-11 the user asked to make the Solyx agent act more on its own, with automation as the end goal. Evaluated, then built as two stacks. The user merged #91 and #92 the same day; #93 → #94 → #95 were then rebased onto `develop` and merged too, all five on `develop`:

- #91 `fix/fund-distributions` → #92 `feat/balance-sheets-cash-flows`: ETF distributions read (FinMind leaves a fund's `AnnouncementDate` empty), `get_fundamentals` tells no source / none on file / could not be read apart, balance sheets and cash flows from FinMind (cash flow lines are year-to-date, taken down to the quarter).
- #93 `feat/agent-memory-unasked` → #94 `feat/agent-save-task` → #95 `feat/agent-change-watchlist`: `remember` runs unasked in `auto`, `get_tasks`/`save_task`, `change_watchlist` plus a watchlist module that pushes to windows.

The user's decisions (theirs, 2026-10-11):

- Memory: the agent records `profile` and `feedback` on its own too, to keep learning how they trade; a conversation set to `ask` still asks.
- Tasks: one the agent keeps defaults to `auto`; under `bypass` saving one need not ask.
- Automation scope for now: research, monitoring, memory and preparing proposals. Automating order confirmation may be planned later; not now. (It came later as the trading mandate, #233.)

My own choices, not confirmed by the user: `forget` still asks unless `bypass`; `save_task` and `change_watchlist` have no auto check (they start recurring work), so they ask in `auto`; the agent names no time zone for a task; only the user removes a task; no provenance column on memories.

**Why:** these gates are easy to widen or narrow by accident in a later change; the split between what the user decided and what I picked says which are safe to revisit.

**How to apply:** Left unbuilt on 2026-10-11: an ETF's NAV, holdings and fees, which waited on the user's decisions in [[solyx-etf-data-sources]] (its profile and restrictions were built there); they are built since (#102–#110, NAV and costs from SITCA in #189). Run-a-task-now, search-a-theme-now, withdrawing a proposal and navigating the window were offered and not picked then; the first two were built on 2026-10-13 as `run_task` (#151) and `search_theme` (#150), the other two still are not. The tests that failed now and then had two causes, fixed in #98 and #99 (both merged): `fs.watch` on macOS starts watching a moment after it returns, so a save made straight after is never reported, and the ChatGPT sign-in listener answered keep-alive, so one test's `fetch` reused the connection the test before left behind. Related: [[solyx-scheduled-work]], [[solyx-agent-setup-tools]], [[solyx-isolated-smoke-run]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-agent-autonomy.md`, type `project`).
