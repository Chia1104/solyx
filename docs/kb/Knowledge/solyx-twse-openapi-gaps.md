---
type: fact
title: 2026-10-18 survey of TWSE (143) and TPEx (225) OpenAPI endpoints Solyx does not read yet, ranked, with data quirks found
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

# 2026-10-18 survey of TWSE (143) and TPEx (225) OpenAPI endpoints Solyx does not read yet, ranked, with data quirks found

On 2026-10-18 the user asked what the exchanges' OpenAPI could add after [[solyx-shioaji-reference]] (shioaji-data's licensed half only repackages these). Nothing built yet; the user had not picked any.

Ranked:

1. Next session's price limits and reference price: TWSE `exchangeReport/TWT84U`, TPEx `tpex_mainboard_daily_close_quotes` (`NextReferencePrice`/`NextLimitUp`/`NextLimitDown`). `OrderDesk.check` never passes `priceBand` or `lastPrice` to `checkOrder`, so the band check is dead and market orders are always rejected.
2. New restriction kinds: attention stocks (`announcement/notice`, `announcement/notetrans`; TPEx `tpex_trading_warning_information`, `tpex_trading_warning_note`) and altered/periodic trading (`exchangeReport/TWT85U`, TPEx `tpex_cmode`).
3. Shares outstanding → market cap: `t187ap03_L` is already fetched for industries only; TPEx `mopsfin_t187ap03_O` has `IssueShares`.
4. Governance risk: director pledges `t187ap09_L`/`mopsfin_t187ap09_O` (monthly, text blob), FSC sanctions `t187ap22`, control changes `t187ap24`–`27`.
5. Lendable shares `SBL/TWT96U` (both markets, today only).

Quirks: TWT84U's English names lie (`PreviousDayLimitUp`/`Down` look like last bid/ask) and it holds ~38k rows including warrants; empty days return a placeholder row (`Number: "0"`, empty `Code`); `opendata/twtazu_od` was stale (dated 2026-06-05); `indicesReport/MFI94U` keeps only the current month; TPEx uses 9999.95/0.01 for "no limit". openapi.twse.com.tw has no robots.txt.

2026-10-28: openapi.twse.com.tw sits behind HiNetCDN, which caches each list by path only (`Vary: Accept-Encoding`; query params and `Cache-Control: no-cache` still HIT), so after anyone asks for CSV everyone gets `text/csv` (Chinese headers) for hours. TWTAWU did this and failed every Taiwan listing's restrictions in the calendar; the user first suspected a date format. Fixed by PR #363 (`keepFresh` `keepOnFailure`, on for fundamentals' whole-market lists); CSV parsing was ruled out.
Same day, after a day of test reads: TWSE answered `exchangeReport/STOCK_DAY_ALL` with an 800-byte HTML security block page ("因為安全性考量，您所執行的頁面無法呈現", with an error code), even for a browser UA, while TWTAWU still answered JSON — a per-endpoint WAF block on this IP. Smoke runs read STOCK_DAY_ALL several times (names, sector closes, funds), so keep test reads of it few.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-twse-openapi-gaps.md`, type `project`).
