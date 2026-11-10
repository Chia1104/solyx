---
type: fact
title: "Trading days, the TW macro schedule and the FinMind plan (PRs #28–#30, merged) and the agent's get_calendar (PR #34, 2026-10-09); scope is Taiwan only, what is left unbuilt"
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

# Trading days, the TW macro schedule and the FinMind plan (PRs #28–#30, merged) and the agent's get_calendar (PR #34, 2026-10-09); scope is Taiwan only, what is left unbuilt

On 2026-10-08 three stacked PRs were opened: #28 trading days (FinMind `TaiwanStockTradingDate`), then #29 the TW macro schedule (new `@solyx/macro`, which reads the JSON embedded in stat.gov.tw's calendar), then #30 the FinMind plan select and trading restrictions. Each PR's base is the previous branch. Once one is squash-merged, rebase the next onto develop.

**Why:** the user asked for all three in order ("這三個都幫我依序調整好了").

**How to apply:**

- The paid FinMind datasets (`TaiwanStockDayTradingSuspension`, `TaiwanStockDispositionSecuritiesPeriod`, `TaiwanStockSuspended`) were never read live, because there is no paid token. Their row shapes come from FinMind's docs. Verify them if the user gets a Backer token.
- `getSession` still knows no holidays. Only `sessionsBetween` (news "sessions since") uses trading days.
- PR #34 (2026-10-09) gave the agent `get_calendar`, which reads the desktop calendar module's `upcoming` through `TradingToolPorts.calendar`; `UpcomingEvents` now lives in `@solyx/core/calendar`. The prompt has the agent read it before web dates. Opened after the user saw the agent's web-sourced event list disagree with the overview's "Coming up".
- The user decided on 2026-10-09 to optimize Taiwan information only; US sources (FRED, FOMC) are off the table for now.
- Not built yet, Taiwan side: market closures from the trading calendar as calendar rows; collapsing per-listing deadline rows; weighting releases by importance; earnings-call (法說會) dates, which need a MOPS source.

Related: [[solyx-commit-to-main]], [[solyx-research-forecast-design]]

## stat.gov.tw and macro values (built 2026-10-12)

The user asked why stat.gov.tw could not be reached and how to make the macro calendar worth more than titles, then said to build the direction I proposed ("好那你幫我依照這優化方向調整"). Three PRs, stacked on #108 ([[solyx-etf-data-sources]]), all merged into `develop` that day:

- #112 `fix/stat-gov-tw-chromium-fetch`: `chromiumFetch` in `main/shell` (Chromium's stack through an in-memory session) handed to `createStatGovTw`.
- #113 `feat/macro-release-details`: a release's time (all 16:00) and its agency's page; schedule kept under the new scope `macro:schedule`.
- #114 `feat/macro-figures`: `@solyx/macro/dgbas`, `MacroSeries`/`MacroReading` in core, a desktop macro module, readings on the calendar, releases kept `RELEASED_DAYS` (7) and listed above the agenda, and the agent's `get_macro`.

Facts worth not re-deriving:

- The outage: the portal's certificate was reissued 2026-10-07 (TWCA) and its server sends the leaf without the intermediate `TWCA SSL Certification Authority`. Browsers fetch it through AIA; Node's `fetch` and curl do not (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). `nstatdb.dgbas.gov.tw` sends a whole chain.
- DGBAS's 總體統計資料庫 API is documented (`/dgbasall/download/API說明文件.pdf`) and anonymous: `https://nstatdb.dgbas.gov.tw/dgbasAll/webMain.aspx?sdmx/<code>/<dim1>.<dim2>.<dim3>.M&startTime=2026-M1&endTime=2026-M9`. Tables: CPI and core `A030601015`, trade `A081201010`, export orders `A050105010`, industrial production `A050104010`, business indicators `A120101010`, growth rate `A018101010` (`.Q`, `2026-Q2`). PMI and the economic forecast are not in it.
- Its quirks: a query needs three dimension segments though the structure lists two; `/all` lists periods only to 2021 while the data is current; a period not out yet answers 0; levels only; a query it does not take answers the table's web page with 200.
- My choices, not the user's: a week of retention, a "recently out" list above the agenda rather than reaching back in it, only the headline figure on a row (exports for trade), one table failing fails the read.
- Not verified: how soon after 16:00 a release reaches the database; the agent in a conversation; the English copy on screen.
- Still unbuilt: forecasts or consensus (no source), the business signal's light colour, importance tiers, the CBC board's dates.

## DGBAS hangs (2026-10-17)

The user reported macro figures unavailable. Cause: `nstatdb.dgbas.gov.tw` hangs some requests for 60–90s+ in bursts (02:25–02:31 Taipei that night) while a resend answers in ~0.1s; ky's 10s default timeout does not retry timeouts, one of six tables failing fails the read, and `keepFresh` rethrows rather than serving the kept answer, so the calendar showed figures unread. Fix on `fix/dgbas-hung-requests` (5s timeout, 4 retries with `retryOnTimeout`, a fake-timer test, macro AGENTS.md line). I offered A (keepFresh serving the kept answer while it refreshes) or B (figures out of `calendar.upcoming` into their own `macro.series` procedure, joined by the renderer and `get_calendar`); the user chose B. Smoke-run in the built app (first DGBAS request per table held: dates showed at once with 讀取數值中…, figures after the ~5s retry), then opened as stack #185 (fix(macro) retry) → #186 (perf: figures apart, base #185).

## Calendar read apart (2026-10-29)

The user saw slow or rate-limited sources hold up the whole calendar and asked for several routes requested in parallel; they approved my proposal ("ok"). PR #383 (`perf/calendar-apart`): `calendar.upcoming` procedure replaced by `listing` (per symbol, `{ events, whole }` as core `ListingEvents`), `research`, `releases` and `closures` (per market); the overview uses `useQueries` and shows "仍在讀取 …" for pending parts; research changes invalidate only `calendar.research` (staleTime Infinity); the backend keeps a composed `upcoming` for the agent's `get_calendar`. Left for later by my call: FinMind's hourly limiter queues a read until the window frees (a listing can stay pending for minutes) rather than failing fast, which would also affect research and flows. Smoke-run note: a FinMind answer held back past ky's 10 s timeout fails that listing alone, and a reload within the hold shares the in-flight read.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-calendar-sources.md`, type `project`).
