---
type: fact
title: "2026-10-16 plan for stale news: gauge decay by voice, freshness line, retention by channel, re-score on title change; what was rejected from an outside proposal and why"
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

# 2026-10-16 plan for stale news: gauge decay by voice, freshness line, retention by channel, re-score on title change; what was rejected from an outside proposal and why

On 2026-10-16 the user said stored news never changes once analysed, goes stale, and the gauge should lean to newer content. They compared my plan with an outside one and approved the merge ("ok 你再幫我處理吧"), as three stacked PRs into develop:

1. Gauge decay: weight × 0.5^(age / half-life), press 48h, crowd 24h; headlines share those half-lives (were 2 days for all). Readings carry how much recent weight they rest on and the newest story's time; below a line the gauge shows "近期資料不足", never 50. `daily` is not decayed. `get_news` uses the same.
2. Retention: announcements/articles kept 90 days, forum/social 30, by published time else found time; pruned on open and daily; Storage shows the days. No VACUUM per prune.
3. A changed title drops the item's scores and vector; writing a score checks the title. Snippets only after measuring how often they change (web snippets are page-start text or Google descriptions).

Rejected from the outside proposal, with reasons the user accepted: separate 14d/7d windows (decay makes them moot, clashes with callers' `since`); re-checking old items (sources only search, costs the user's web-search key, PTT threads would be crawling); re-scoring on model change (rare, scores record their model); evidence snapshots (already exist: claim quotes, falsifier_checks copies, ProposalBasis, theme_items); batch deletes and idle VACUUM (volume ~57 items/day in Dev); changing story leads for corrections (grouping windows are ≤3 days).

Built 2026-10-16 as stack #180 (gauge decay, base develop) → #181 (retention) → #183 (title re-score); all three merged since. The recent line is 0.5 of faded weight, not 1: at 1 a single fresh story never counted as recent. On Dev data a retention pass pruned 19 crowd posts. Snippet change rate measured 2026-10-16 without any key: Dev and Nightly both use Firecrawl, whose key is only in the app's secret store, so I re-embedded each stored item's current storyText with the local qwen3 model (deterministic, cosine 1.000000 twice) against the vector made when it was first embedded. Over 13.4 days: web-article 14/551 (2.5%), web-social 11/90 (12.2%), PTT/announcements/insider 0; 16 of the 26 listing rows of changed items count in the gauge. About two items a day, so re-scoring on a snippet change is cheap. The user then had #183 re-read on a snippet change too (beyond spacing; a respaced snippet keeps the stored one), retitled "read a news item again once its title or snippet changes". Later the same day the user asked for retention to be theirs to set: #181 now holds `news.kept.{press,crowd}` in config.json (30d/90d/180d/365d/forever, 30 the floor since agent reads go back 30 days), a select per voice on the Storage tab that asks before shortening, retention following config changes to prune at once, and no `change_setting` for it. The user rebased the stack after merging #184; I fix CI by commits merged up the stack, never force-pushing. Separate fix #184 (merged): stories' "another N alike" counted the lead, since `shown()` copies the lead apart from its records (`retellings` in core now).

**Why:** a score is a reading of fixed text; what changes is its bearing on now. Nothing reads news past 30 days except `search_history`.

**How to apply:** built in this order, nothing of it is left; see [[solyx-news-organization]], [[solyx-stacked-pr-merges]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-news-freshness.md`, type `project`).
