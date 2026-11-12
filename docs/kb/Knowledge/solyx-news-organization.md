---
type: fact
title: "Direction approved 2026-10-10 for organizing news and letting the Solyx agent maintain it unattended: report events on the calendar, scheduled runs, themes, change-triggered wakeups; decisions and build order"
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

# Direction approved 2026-10-10 for organizing news and letting the Solyx agent maintain it unattended: report events on the calendar, scheduled runs, themes, change-triggered wakeups; decisions and build order

On 2026-10-10 the user said news felt scattered and stale, wanted international affairs (their example: a plague outbreak in Russia) tracked for long-run effect, and wanted the Solyx agent to organize information more on its own. They approved my proposed direction with "先照你建議的這方向試試".

Build order agreed:

1. Report events (`report.events`) gain a source, the source's words and a timing, pass the claim auditor, and join `UpcomingEvents` so the overview calendar and `get_calendar` show them apart from official dates; passed ones are flagged for the next revision.
2. Scheduled agent runs (the "layer two" in [[solyx-scheduled-work]]) plus a built-in tidy-up skill.
3. Themes: standing topics the user approves (title, why it may matter, zh/en search terms, linked listings with direction, escalation signposts read against news the way falsifiers are). Collected by topic queries without a symbol on a slow cadence; quiet until a signpost is hit; ordered by time since the last development, not article age.
4. Change-triggered wakeups (falsifier signal, passed event, signpost hit, new quarter out) instead of free-running on a clock.
   Deferred to last: show a listing's news as the delta since its report's revision.

Step 1 is PR #81 (branch `feat/report-events`, opened 2026-10-10, base develop): `reportEventSchema` with timing/source/quote, `EventTiming.Expected`, `eventClaim(event, market)`, violations `event-passed` and `event-unsupported`, `Coverage.passedEvents`, `reportedEvents` and `UpcomingEvents.research`. Measured with `eval-claims` on the user's `.env` keys (TypeSafe jev-1.13.0 and OpenAI gpt-6-luna; Cloudflare has no account id there): a day fixed in Taiwan is worded with its ROC date too, a day only expected as month/day without the year. Events kept before it have no source; no migration was written, per the repo rule.

Step 2 is PR #82 (branch `feat/scheduled-runs`, base `feat/report-events`, stacked on #81): `@solyx/core/schedule` (`ScheduleApproval` ask/auto only, `isDue`, `nextRun`, 12h grace for a missed time of day), `scheduled_tasks` in user.sqlite, `main/modules/schedules` (now `packages/backend/src/modules/schedules`), `agent.runScheduled` and `runtime.busy`, an `OriginDoc` so `AgentSession.schedule` names the task, a `scheduled` context line plus prompt rules, the `watchlist-upkeep` skill, a Schedules settings tab, and a `get_setup` area. The task stores its own `timeZone` and `locale`, since those are renderer preferences the main process does not hold. Left out: marking a report revision with the run that made it, a model pick per task (both Linear CHI-39).

Step 3 is PR #83 (branch `feat/themes`, base `feat/scheduled-runs`, stacked on #82): `@solyx/core/theme` (`ThemeDesk`, developments are readings at or above `CLAIM_SUPPORT_LINE`), `themes`/`theme_items`/`theme_readings` in user.sqlite, `main/modules/themes` (now `packages/backend/src/modules/themes`) with a daily search pass through the web search vendor (`market: null`), agent tools `get_themes` and `save_theme` (guarded, no auto check), an overview section and a Themes settings tab. Its settings strings live under `settings.theme-watch`, because `settings.themes` already holds the appearance themes. Not measured: how a decisions model reads a headline against a signpost; no real search was run, since the throwaway identity has no web search key.

Step 4 is PR #84 (branch `feat/change-wakeups`, base `feat/themes`, stacked on #83): `ScheduleKind.OnChange` with `atMostEveryMinutes`, `@solyx/core/changes` (`changesSince`: falsifier met, event passed, signpost met; pure, no provider request), `isDue(task, now, { trades, changed })`, a 30-minute `changeWork` pass beside the one-minute clock pass, and `changed:` lines in the run's context. A newer quarter is deliberately not a change, since learning of one asks the fundamentals provider.

On 2026-10-10 the user asked whether news auto-collection could join the schedule architecture and agreed to my proposal: unify the timing model and the management surface, not the entity. That is PR #86 (branch `feat/collection-schedules`, base `feat/change-wakeups`, stacked on #84): `CollectionPlan` and `collectionDue` in `@solyx/core/schedule` (interval or time of day, never on-change, no grace), plans in config.json under `collection.news` / `collection.themes` (default time zone is the host's), `news.collectEveryHours` removed with no compatibility layer, `main/modules/schedules/collections.ts` (now `packages/backend/src/modules/schedules/collections.ts`), a shared `createScheduleDays`, a "What the app collects" section on the Schedules tab, and `change_setting` taking off, on or hours for each. A collection stays its own type: no prompt, model or conversation.

The stack is #81 → #82 → #83 → #84 → #86; all five are merged. Still deferred (Linear CHI-39): showing a listing's news as the delta since its report's revision, marking a report revision with the run that made it, a model pick per task. A setting for how often themes are searched is no longer missing: the themes pass reads #86's `collection.themes` plan (`packages/backend/src/modules/themes/themes.ts`), though CHI-39 still lists it.

Decisions:

- A scheduled run's approval mode is the user's choice on the schedule itself, `ask` or `auto`, never `bypass`. This replaces "never set approval mode" recorded in [[solyx-scheduled-work]].
- Unattended autonomy covers only the agent's own views (report revisions, events, theme developments); orders still stop at `propose`, memory and settings still ask.
- Revisions made unattended are tagged with their origin and gathered where the user sees them; a theme an unattended run creates starts as a suggestion until the user accepts it.
- Themes link to listings only at first, not sectors (my default; the user did not object), since `./sectors` covers only TWSE's sector indices.

**Why:** news existed only as listing × article with nothing durable above it; unattended reading of third-party text that becomes kept views is the main risk, so writes stay sourced, audited, reversible and visible.

**How to apply:** the four steps and #86 are merged, so what is left is the deferred list above, as PRs into develop ([[solyx-commit-to-main]], [[solyx-stacked-pr-merges]]); do not reopen the approval-mode question.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-news-organization.md`, type `project`).
