---
type: fact
title: "Scheduled work in Solyx: the shared main-process clock (PR #32) and the keepFresh kept-answers helper over cache.sqlite (PR #33) landed 2026-10-08; user-defined scheduled agent runs are the next planned step"
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

# Scheduled work in Solyx: the shared main-process clock (PR #32) and the keepFresh kept-answers helper over cache.sqlite (PR #33) landed 2026-10-08; user-defined scheduled agent runs are the next planned step

Modelled on t3code's `apps/server/src/scheduling/Scheduler.ts` and `scheduledTasks/ScheduledTaskService.ts`.

**Rule agreed 2026-10-08:** periodic work is one of two kinds, chosen by who needs the result.

- Nobody waiting (push): `ScheduledWork` on `apps/desktop/src/main/scheduler.ts` (PR #32, branch `feat/scheduler`): `everyMs` + `run()`, skip-if-busy, failures logged per name, ticked again on `powerMonitor` resume. News collection and update checks register with it.
- Someone asked (pull): a kept answer with a freshness policy at the call site, re-read when stale or after a failure, `forget()` when what a provider may read changes. Never prefetched on the clock, since that spends a shared provider limit (FinMind's hourly one) with nobody looking.

**Done as PR #33 (branch `feat/kept-answers`, opened 2026-10-08):** the FinMind stack (PRs #28–30) hand-rolled the pull kind three times with the same `Map<key, {at, promise}>` logic: `main/modules/market/trading-calendar.ts` (fresh for the same exchange day), `main/modules/calendar/calendar.ts` (macro schedule, 12h) and `main/modules/fundamentals/fundamentals.ts` (per listing, 12h, `forget()` on plan/token change). Collapsed into `keepFresh` in `@solyx/utils/fresh` (es-toolkit's `memoize` has no TTL or failure eviction), freshness as a predicate so "same exchange day" and "12 hours" both fit. The answers persist in `cache.sqlite` (re-fetchable data belongs there, and restarts would otherwise spend FinMind's 600/1600 hourly limit) in one generic table `kept_answers(scope, key, asked_at, answer json)` with PK (scope, key); `forget()` deletes by scope; old rows pruned on open. `cache.answers(scope)` is the store port; the helper keeps only in-flight promises in memory. The push/pull rule is in `apps/desktop/AGENTS.md`. Tests use `memoryAnswers()` from the same module. `config-file.test.ts`'s watcher case is flaky under a full parallel run (seen once in four runs), unrelated.

**Layer two is built as PR #82 (2026-10-10), see [[solyx-news-organization]].** It differs from the decisions below in two ways: a task stores its own time zone and locale (they are renderer preferences, not a main-process setting), and a task picks `ask` or `auto` for its run's approval mode, never `bypass` (the user agreed on 2026-10-10, replacing "never set approval mode"). The decisions as first recorded:

- Module `main/modules/schedules/`, table in `user.sqlite`; next-run maths in `@solyx/core`; its due-task pass registers with the existing scheduler.
- Schedule shapes: interval and fixed_time only, fixed_time in the user's `timeZone` setting (not host zone), with an option to run only on a market's trading days via the trading calendar.
- A run = `agent.send` into a new conversation (bind-to-existing deferred); "succeeded" means send accepted. `AgentSession` needs an origin/scheduleId field.
- Runs only reach `propose`; never set approval mode. Skip when busy; no retries.
- Missed fixed_time runs catch up with a wider grace than t3code's ten minutes, since a desktop app is often closed at the time.
- No webhooks or relay (no local HTTP server), no MCP `schedule_task` tool in the first cut.

**Why:** the user wanted the shared clock first, then one way to manage this kind of work rather than ad hoc caches; scheduled agent runs come last. See [[solyx-commit-to-main]] for the PR workflow and [[solyx-calendar-sources]] for the FinMind stack.

**How to apply:** when touching any of the three caches or adding periodic work, follow the push/pull rule above instead of adding timers or new maps.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-scheduled-work.md`, type `project`).
