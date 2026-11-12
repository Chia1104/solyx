---
type: fact
title: "kansoku-inspired K-line trend layers — #66–#68 merged (MAs, levels, RS vs TAIEX); #70 intraday VWAP/session levels and #71 forecast anchor marker opened 2026-10-09, independent of each other"
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

# kansoku-inspired K-line trend layers — #66–#68 merged (MAs, levels, RS vs TAIEX); #70 intraday VWAP/session levels and #71 forecast anchor marker opened 2026-10-09, independent of each other

On 2026-10-09 the user asked to bring kansoku's (`~/Documents/GitHub/kansoku`) chart annotations into solyx, and chose Taiwan conventions over Minervini's 50/150/200: MAs 5/10/20 + 60/120/240 (季/半年/年線), zones = 季線 ±2% and 半年線 ±3% (not a band between two long lines, which would be too wide), 年線 as a break marker, RS periods 20/60/120 against TAIEX `IX0001`.

- #66 long MAs as a separate toggle + volume ratio pane + daily lookback 2 years.
- #67 `@solyx/core/levels` (52-week range, volume profile, support zones, breaks) + `<Series markers bands>` with a `PriceBands` primitive.
- #68 relative strength pane via `BENCHMARK` in core/market.
- All three landed on develop in order on 2026-10-09 (34b8d8f, 99f4114, 6bcaafd); see [[solyx-stacked-pr-merges]].
- #70 (from develop): `vwap` (reset per exchange day, each session's last point transparent so LW draws no jump), `previousSession`/`openingRange` (first 30 min, bars ≤30m, after it passes). #71 (from develop): anchor marker on the first forecast path, direction + outcome. Both merged.
- Only rendered with synthetic bars; never checked against real Fugle data in the app (index candles for IX0001 are documented, not observed). That was 2026-10-09; the user's run of the rotation graph on 2026-10-21 showed Fugle serving index bars ([[solyx-sector-rotation]]), though I still have not checked these layers on real data.

**Why:** the user wants SEPA-style trend reading on their own Taiwan data.
**How to apply:** the original plan is fully merged; US pre/post-market shading waited for a US data source, which exists since #357 (Longbridge), and is still not built. A Lightweight Charts marker's `shape` must be written `["shape"]` because the vendored anti-slop lint bans the identifier. Related: [[solyx-research-forecast-design]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-trend-layers.md`, type `project`).
