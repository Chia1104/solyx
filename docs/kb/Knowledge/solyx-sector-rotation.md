---
type: fact
title: "Relative rotation graph (TWStockRS rs_v1 port) for TWSE sectors and listings; #262–#272 built 2026-10-21; interaction pass #273 (timeline, local playback) → #274 (pins, group toggles); decisions and what is unverified"
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

# Relative rotation graph (TWStockRS rs_v1 port) for TWSE sectors and listings; #262–#272 built 2026-10-21; interaction pass #273 (timeline, local playback) → #274 (pins, group toggles); decisions and what is unverified

2026-10-21: the user asked how `~/Documents/GitHub/twstockrs-web-share-clean` computes 台股相對強弱輪動 and had it ported into solyx as a stack: #262 `@solyx/core/rotation` (rolling z-score level and momentum, quadrants, trail, transition), #263 main-process `market.rotations` kept a minute + agent `get_rotation`, #264 類股輪動 chart on the overview's Market tab.

**User feedback 2026-10-21 (after running #264):** 31 sectors too cluttered, the vertical 動能 label read upside down (CJK in vertical-rl + rotate-180), and asked for listings too. Answered in #264 (group filter, hover lifts one line and dims the rest, axis names laid flat at the cross's ends) and #266 (持股與追蹤 section on the same `RotationGraph`, host-read `market.listingRotations`, agent reads listings through it). The user did see the chart running, so Fugle serves index bars.

**Symbol page (user asked 2026-10-21):** the listing's rotation sits at the top of the research panel (研究 lower view), against its market index and its own TWSE sector index (`sectorOfIndustry` from the company's industry code); I chose the research panel over a fifth lower view or a chart pane.

**Follow-ups 2026-10-21 (the user merged #262 to #267, then asked for the gaps I listed):** stack #268 (weekly: `RotationInterval`, 13/26/52 weeks, closed weeks only, benchmark weeks matched by first day; main-process `rotations.ts` module) → #269 (playback: `through` on every read, index bars kept in memory a minute, 120-session slider on both overview graphs, agent `through`) → #270 (`benchmarkFitness` 240/228/4 as TWStockRS, TW indices exempt via `isTwIndex`, 基準 field on 類股輪動, agent `benchmark` and `against: sector`). Then #272 (perf, user reported seconds of loading on param change): one-pass rollingZ with running sums + monotonic range queues and an exact fallback (2.5 ms → 0.015 ms per line; 31 sectors 560 ms → 23 ms), bars dated once, index and listing bars kept in memory per exchange session (5 min in the regular session) instead of a minute, keepPreviousData + dimmed plot with spinner. Not built: free period/trail, equal-weight sectors, TPEx sectors, industry-change markers, gap markers, display curves.

**Interaction pass (user asked 2026-10-21 to improve the overview's rotation UX and whether a slider suits playback):** stack #273 (on #272) → #274. #273: the graphs get each path across the 120 sessions once (`RotationHistory`, `readingThrough`/`playbackPath` in core; `through` dropped from the RPC inputs, kept for the agent) and cut readings locally; the slider became a timeline strip along the benchmark's closes (play at 250 ms/bar, step ±1, back to latest, weekly steps by week); axes fixed to the whole window's reach so dots move on a still plot. #274: pin entries (dot or sector row; `ChartMark` gained `pressed`/`onPress`), group select + legend → one row of toggles, trails fade towards their start, quadrant counts. Seen with synthetic Fugle bars only. Possible next: speed control, hover-preview on the strip, robust (quantile) axis reach if real data looks zoomed out.

**Slow first load, measured 2026-10-25 (user asked whether the Rust kernel would fix it):** CPU is not the cause. On the user's real cached bars (32 series, 727 bars each): dating 34 ms, paths 26 ms, a 1.2 MB payload, 15k stops. With the cache warm the whole read takes 0.3 s at a simulated 200 ms latency. With the cache cold it takes 120 s: Fugle refuses ranges of a year or more (`MAX_RANGE_DAYS` 360), so 1095 days needs 4 requests a symbol, 128 in all, and history is capped at 60 a minute on every Fugle plan and on Fubon. `splitRange` asks oldest first and `Promise.all` waits for everything. The cache goes cold on a new install, a cleared cache, a switch between Fugle and Fubon (it is keyed by source id), and each channel. The first launch each day still costs one history request per series. Ideas I gave: a 1080-day span (96 requests, about 60 s), and the newest year first so daily 20/60 draws in about 1 s. Scheduler prefetch is ruled out by backend AGENTS.md. Bench scripts are in /tmp/solyx-rotation-bench.

**PR #316, opened 2026-10-25 (user asked for both ideas):**

- The span is now 1080 days.
- `recentBars` reads 360 days, then `spanBars` reads the two older ranges through `market.candlesBetween`. Bars are kept per symbol; the source-keyed index Record is gone.
- `market.rotations` and `listingRotations` became streams read with `liveOptions`. They send the newest year first, `complete: false`, only when the whole span is not in within 250 ms.
- Smoke test with Fugle's Developer plan: the graph showed at 2 s and was whole at 61 s.
- Open problem found then: on Fugle's free plan the intraday budget is 60 a minute. The heat map's 31 quotes plus the rotation's 32 intraday candles make 3 requests wait a minute, so the newest year cannot show early. That costs about 60 s even with a warm cache.
- The user picked the first fix: take today's sector close from the heat map's quotes.
- Also seen: on a Sunday the weekly reading still left out the week just closed (latest 10-16).

**Stack #316 → #317 → #319, 2026-10-25 (all merged):**

- #317 `weekUnderWay(market, at, trades = weekdays)` in core: a week stays under way while a regular session of it has yet to close. `rotationPaths` takes `openWeek: string | null`, and `RotationClock` holds `at`.
- #319 builds two reader sets with `spanReaders`:
  - `bars` covers listings, the TAIEX and a sector index read alone; it reads its own intraday bars.
  - `sectorBars` covers the sector set: closed sessions through yesterday, plus the quote from `marketData.sectors()`, appended only when newer.
  - A listing's page still reads its sector index's intraday bar, so it does not spend 31 quotes.
- Smoke test on the free plan: 31 quotes plus 1 intraday candle; the newest year showed at 2 s and everything was in at 61 s; the weekly reading ended at 10-23 on a Sunday.

**Decisions I made (user did not weigh in):** sector series are TWSE's own indices (IX00xx) against IX0001, not twstockrs's equal-weight rebuild, since solyx keeps no membership history; periods reuse RELATIVE_STRENGTH_PERIODS (20/60/120), trail fixed at 10; quadrant backgrounds carry no red/green (renderer design rule); listing rotations in `get_rotation` use `adjustedCandles`; weekly frequency was left out at first (built in #268).

**Unverified:** the #264 fixes and #266's chart were not seen running by me.

**Why:** the user may ask to extend or revisit these picks; [[solyx-chart-d3-tooltips]] holds the ChartMark pattern the chart follows.

**How to apply:** weekly rotation is built (#268); TPEx sector indices do exist in Fugle's data (IX0044–IX0059, IX0075, IX0099, IX0100, IX0189–IX0191, seen in a snapshot on 2026-10-30); whether historical candles serve them is unchecked.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-sector-rotation.md`, type `project`).
