---
type: fact
title: "2026-10-15 roadmap from an outside feature review (discover change → update view → review proposal → check afterwards); item 1 is PR #165"
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

# 2026-10-15 roadmap from an outside feature review (discover change → update view → review proposal → check afterwards); item 1 is PR #165

On 2026-10-15 the user brought an outside feature review of Solyx and asked whether its direction was right. I checked its claims against the code and proposed this order, which the user accepted ("ok"):

1. Watch status: say whether news is read against a report's falsifiers and a theme's signposts. Built as PR #165 (`feat/watch-status`, merged 2026-10-15): `FalsifierPass` kept per listing in `research.sqlite`, `Coverage.watch` with `WatchGap`s, `ThemeWatch.unread`, research panel, themes list, `get_research` and `get_themes` text. Research refetches on a settings push.
2. Order impact on the proposal card: estimated amount and position/cash before and after. Built as PR #166 (`feat/proposal-impact`, from develop, independent of #165): `orderImpact` in `@solyx/core/order`, shown only while a proposal waits; before fees and taxes, since the paper broker charges none; the agent's `propose_order` answer left unchanged.
3. A "to handle" list on Today, read from stores only, with no dismiss state (items clear when acted on). Built as PR #167 (`feat/today-inbox`, from develop after #166 merged on 2026-10-15): main `inbox` module + `inbox:changed` push, `ResearchDesk.backlog` shared with coverage, `approvals()` shared with the tray, the symbol page's lower pane in the URL as `view`. Newer financials left out (would spend FinMind requests). Conflicts with #165 in `coverage` only; rebase whichever lands second.
4. Proposals linked to research: the tool stamps the report revision in force and the newest forecast at propose time; the agent does not choose. Core AGENTS' "Neither reaches the OrderDesk" needs rewording then.
5. Scope (listings, themes, change kinds) for tasks that wait on a change, folded into the paused [[solyx-scheduling-discussion]]; store the changes on `ScheduledRun`.
6. Forecast review as a scheduled task with no code, monthly or once enough have settled, since samples are tiny.

The user's Codex reviews (2026-10-15, posted as PR comments) found three defects, all fixed by new commits on the branches: #165 unread counted falsifier×item pairs, and concurrent passes per listing overwrote each other (now an es-toolkit `Mutex` per listing in `ResearchDesk.watch`); #167 the inbox never refreshed across an exchange's midnight (first a renderer timer; at the user's question moved to an "Exchange clock" `ScheduledWork` in the main research module that pushes a research change as a market's day turns or its regular session opens/closes, so research coverage is never stale on its own; `useClock` also re-renders at the user's midnight). The user's audit question "其他地方沒跟排程架構整的" found only those two; sessions/quotes/sectors timers in `followQuotes`, candle polling without a stream, MCP connect polling and staleTime 0 for disk-read settings are by design. On 2026-10-15 #165's branch was rebased onto develop on GitHub (same patches), which re-conflicted #167; fixed by merging it in again with our side (tree unchanged). I did not reply on GitHub. The user then asked to stack them to merge at once: `feat/watch-status` was merged (not rebased) into `feat/today-inbox` with `coverage` resolved, and #167's base set to `feat/watch-status`. Advised order: #167 into `feat/watch-status` first, then #165 into `develop` (one squash, #167's title absent from release notes); #165 first would re-conflict #167.

Found while building item 1: with default settings the falsifier watch never ran, since it needs embeddings on, from this computer, on `qwen3-embedding:0.6b` (the only floor), plus a decisions model. A fresh identity's first news collection came about 8 minutes after launch; `window.solyx.schedules.collectNow("news")` runs it at once. Seeding research needs Node 26 for Temporal: `vp exec node script.mts`.

#165 and #167 both landed on develop on 2026-10-15 (`05510ee`, `c1590d9`), then the user's oRPC stack (#169–#174, see [[solyx-orpc-migration]]) merged on top; the inbox, research `changes` streams, settings-push refetch and the "Exchange clock" pass all survived it.

Re-estimate after oRPC (2026-10-15; the user approved it with "ok 就照這方向吧": the desk stamps both roads, item 5 un-paused as its own small PR):

- Item 4: core/db/agent work unchanged; desktop smaller, since `proposals.contract` outputs `type<TradeProposal>()` and a new field needs no contract change. The route shows the user also proposes (`ProposalSource.User`, `proposal-form.tsx`), so I recommend the `OrderDesk` take a reader of the research basis from its host, as it takes `tradingDays`, stamping both roads, rather than the agent tool alone; core AGENTS' "Neither reaches the OrderDesk" changes then. Proposals sit in user.sqlite, research in research.sqlite: the stamp is a value, not a key, and must read fine after research is cleared. No live comparison on the card: reading coverage settles forecasts, which reads bars.
- Item 5: the 2026-10-08 scheduling discussion is mostly overtaken by what was built (interval / fixed-time / on-change tasks, collection plans; t3code's webhook is excluded by the no-HTTP-server rule). Proposed doing it as a small standalone PR: scope on on-change tasks, changes kept on `ScheduledRun`; scope by named listings would not need the account read that makes the change pass 30 minutes. oRPC adds nothing here: `taskDraftSchema` extends the core schema; `windowEvents` is for windows, main modules still call each other directly.
- Item 6: still no code, but the longest interval is 7 days (no monthly), fixed-time has no weekday pick, and "once enough settled" cannot be a change kind: forecasts settle only when read, and settling eagerly would spend provider requests with nobody looking. So a 7-day interval task whose prompt stops early when few settled.

Item 4 is PR #175 (`feat/proposal-basis`, from develop, opened 2026-10-15, merged since): `TradeProposal.basis` (`ProposalBasis`: report revision/revisedAt/stance and the newest forecast under that revision, id/createdAt/direction/horizon, `null` when the desk has no reader), `OrderDeskOptions.basis` wired in `services.ts` to `research.desk.basis`, nullable JSON column `proposals.basis` (migration `20261015110904_proposal_basis`, placed last since the migration test compares column order), `describeProposal` text, and a basis line with a "看研究" link on the card. Smoke-checked from the order form; `window.solyx` is gone since oRPC, so smoke runs drive the UI and seed databases before launch.

Item 5 is PR #176 (`feat/change-scope`, stacked on #175 because both add a `user.sqlite` migration and drizzle-kit snapshots chain; both merged since): `ChangeScope` (kinds ≥1, listings/themes `null` = every one) on the on-change schedule, `changesSince(..., scope)`, `ScheduledRun.changes`, custom migration `change_scope` filling `EVERY_CHANGE` and `changes: []`, the account read only for a scope naming no listings, `save_task` `changeKinds`/`listings`/`themes` with unknown theme ids refused, scope fields in the task editor (`change-scope-fields.tsx`). Left out: a faster change pass for scopes naming listings.

**How to apply:** item 6 (forecast review, Linear CHI-79) is a task to write, not code: a 7-day interval task whose prompt stops early when few forecasts settled; offer it when the user asks to continue. Smoke runs: HeroUI checkboxes need `agent-browser click @ref`, a JS `label.click()` does not toggle them. Related: [[solyx-research-forecast-design]], [[solyx-isolated-smoke-run]], [[solyx-scheduled-work]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-workflow-review.md`, type `project`).
