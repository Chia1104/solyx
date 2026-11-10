---
type: fact
title: "2026-10-17 audit and stack #193 → #194 → #195 gathering scattered helpers into @solyx/utils (date, server, json, text, format, search), agent figures and core labels; what was left out and why"
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

# 2026-10-17 audit and stack #193 → #194 → #195 gathering scattered helpers into @solyx/utils (date, server, json, text, format, search), agent figures and core labels; what was left out and why

On 2026-10-17 the user asked for an audit of scattered utils and whether date/Temporal handling could live in `packages/utils`. Asked to go ahead, the user said "可以更新依賴沒關係，目標是集中管理這些 utils 方法": adding dependencies is fine, and the goal is one place per helper. So utils now depends on zod.

Opened as a stack, each to be retargeted to `develop` after its base merges (see [[solyx-stacked-pr-merges]]):

- #193 `@solyx/utils/date`: the time constants, `wallTime`/`shiftDate` (moved out of core/market) and `shiftMonth`. ROC dates go through `twRocDaySchema` in `core/rules/tw`, `barTime` is in `core/candles`, and the computer's zone is read with `Temporal.Now.timeZoneId()`.
- #194 `./server` (atomic write, read-if-exists, readJson, PKCE), `./json` (`parseJson`), `./text` (`normalizeSpace`, `truncate`, `firstLine`, `tildify`), `./format` (`formatBytes`) and `matchesFilter` in `./search`. `tildify` was unanchored, a real bug; it now replaces home wherever a path starts there, including inside MCP command lines.
- #195 the agent's number formatting in `packages/agent/src/figures.ts`, where a plus goes only above zero. Also core's `symbolLabel` and `twLots`, utils' `counted` and `cssPercent`, and db's `removeSideFiles`.

**Why things were left out:**

- The renderer's `utcDay`: Electron 44's V8 formats a `Temporal.PlainDate` in zh-TW `{year, month:"long"}` as `2026/10`, not `2026年10月`.
- `Promise.withResolvers`: the tsconfigs use lib es2023.
- `pairs()` in `core/news`: it treats a single letter differently from utils', so it is not a copy.
- `wire.ts`'s JSON parse: `?? text` would turn a `null` into its text.
- Left in place as idioms or single copies: the short hex ids (`randomBytes(5)`), the React copied-flag hook, `readOrNone`, the `lastAt`/`nextAt` max/min, union-find, `cosine` and `quantile`.

**How to apply:** new generic helpers go into these utils modules rather than local copies. Agent tool text uses `./figures`.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-utils-centralization.md`, type `project`).
