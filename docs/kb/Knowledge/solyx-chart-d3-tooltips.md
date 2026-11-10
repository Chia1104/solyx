---
type: fact
title: "2026-10-21 chart presentation decisions — sector movers as gradient row bars (no edge), d3-scale/d3-shape + own ChartTooltip instead of Recharts; PRs #258, #259 → #260"
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

# 2026-10-21 chart presentation decisions — sector movers as gradient row bars (no edge), d3-scale/d3-shape + own ChartTooltip instead of Recharts; PRs #258, #259 → #260

On 2026-10-21 the user asked to improve chart presentation.

**Sector movers (產業主力)**

- Of three mockups the user picked "A": each row's ground is a bar from the left edge, its length the row's share of the largest part, washing from clear to the direction colour.
- They asked to drop the 2px edge line at the bar's end.
- First built as a plain `<table>` with the bar under the whole row. The user then asked to keep HeroUI's `Table` and draw the bar only in the 貢獻 cell. They also asked for the same effect in the symbol page's 五檔.
- PR #258 now has a shared `components/wash-bar.tsx` (`WashBar`: share, color, `fromRight`).
- 五檔: I first drew the sizes in `--muted`, then in the session's move colour. The user settled on per-level colour: each bar takes its own price's colour against the reference, as the price text does, and `--muted` at the reference.
- 行事曆: the user asked for more 底色 on the reading trend, so `Sparkline` got a `shade` option (default 0.24) and the calendar passes 0.6.
- The user then asked for the trend in its own direction's colour. Asked about the red/green rule, they chose the user's price-colour settings (`useDirectionColors(release.market)`, as the watchlist does), judged by the newest period against the one before.
- The renderer AGENTS.md rule now reads: red and green mark "a price's, or a released figure's from its previous period" direction. This reverses #253's grey macro sparklines.

**Chart library**

- I recommended Recharts. HeroUI Pro's charts are Recharts too, but Pro is paid, so open-source CI and contributors cannot install it.
- The user wanted something lighter: d3 with a tooltip of our own.
- Built as a stack:
  - #259 adds `d3-scale` and `d3-shape` to the `charts` catalog. It moves Sparkline, MarginLines (one band a quarter reaching halfway to its neighbours, with dots on hover), TrendColumns and CalibrationChart onto them, and adds the rule to the renderer AGENTS.md.
  - #260 does the same for net buying (d3 `stackOffsetDiverging`), realized trips, the forecast strip and stance history.
- First version: I wrote a pointer-following portal `ChartTooltip`, claiming HeroUI's Tooltip needs a focusable trigger. The user pointed out that the heat map already gets one with `Focusable` + `Tooltip`.
- Both PRs now use `components/chart-mark.tsx` `ChartMark`: a `role="img"` span under react-aria `Focusable` inside HeroUI `Tooltip` (150 ms delay), which opens on keyboard focus too. Each mark is a tab stop, as the heat map's tiles are.
- **Lesson:** before writing a UI primitive, check how the codebase already solves it (here `heat-map.tsx`).
- Shares of the largest column stay hand-computed. d3 maps an empty domain to the middle of the range, but those charts need zero there.

**Not seen in the smoke run:** calibration dots, the forecast strip, stance history and realized trips need settled research or trips.

Related: [[solyx-chart-candidates]], [[solyx-isolated-smoke-run]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-chart-d3-tooltips.md`, type `project`).
