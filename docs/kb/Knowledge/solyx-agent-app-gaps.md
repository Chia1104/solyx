---
type: fact
title: "Audit of what the Solyx app shows that its agent cannot read (2026-10-13): what was built, what the user deferred, what is left"
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

# Audit of what the Solyx app shows that its agent cannot read (2026-10-13): what was built, what the user deferred, what is left

On 2026-10-13 I compared what the app serves its windows (`apps/desktop/src/shared/ipc/*.ts`) with the agent's tools (`AgentToolName` in `packages/agent/src/wire.ts`) and the functions `run_analysis` scripts may call.

**Built that day, by the user's choice:** `get_sectors` with the sector map under the call (#137, #138, merged), then `get_quotes` (#140), `get_headlines` (#141) and `get_task_runs` (#142), three unstacked PRs from `develop`, all merged the same day.

**Deferred by the user:** search over all past conversations. They called it "相對較大" and said they would evaluate it. What I proposed: a `conversation` kind in `search_history` plus a reader; index only the user's messages and the agent's replies, in the app's own database rather than pi-durable's `agent.sqlite`, synced before each search; keep results out of quote provenance (`readTexts`) and out of found addresses; offer it only while `agent.memory` is on (my suggestion, not decided). `get_task_runs` deliberately reads scheduled runs only, so this stays open.

**Then built the same day, on the user's go-ahead, as two stacks:** #143 the app's addresses in the prompt (`PromptSources.links`, built in `#shared`) → #144 the screen in each message's context (chart interval and indicators, overview tab, settings section); #145 script sources (`market`, `flows`, `fundamentals` globals, split by dataset, 50 listings a script) → #146 bars from further back for scripts (`since`, ten years, five listings) with `fundamentals.cashGoneEx`. Left out on purpose: the pane under a chart in the screen state, news in scripts, a tool that moves the window.

**Then, also 2026-10-13, the three I had called low value, on the user's go-ahead:** #149 a Storage area in `get_setup` (sizes and counts, never clearing); #150 `search_theme` (unasked like `web_search`, at most once an hour a theme); #151 `run_task`, stacked on #150 (asks every time, refused inside a run a task started and while the last run goes, does not wait). #143–#146 were merged before these.

**Script functions and a catalog.** On 2026-10-13 the user asked whether to split methods or build a catalog as script functions grow. I recommended, and built, splitting by dataset (the scarce thing is FinMind's 600 requests an hour, not tokens) and grouping under namespaces with every type still declared; they did not object. `run_analysis`'s description is about 2,150 tokens after #146, from 800. The line I gave was about 2,500 tokens: the next batch of script functions should move the sources behind a catalog (a line per function in the description, types on request, as the MCP `codemode` tool does; pi-codemode gives scripts `ALL_TOOLS` and exports `renderToolSample`). Field descriptions on a zod output schema spread its declared type over a line a field, so notes belong in the function's description.

**Unverified against Fugle:** whether `get_candles` serves a sector index such as `IX0028`, which `get_sectors`' description promises; how far back its history answers and what a ten-year read costs.

**How to apply:** start from this list rather than auditing again, and check each item against the code first, since some may have been built since. Related: [[solyx-agent-autonomy]], [[solyx-isolated-smoke-run]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-agent-app-gaps.md`, type `project`).
