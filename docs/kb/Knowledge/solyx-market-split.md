---
type: fact
title: 2026-10-29 TW/US separation in the symbols pane and overview, plus US sectors from SPDR sector ETFs; the user's picks and the planned stack
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

# 2026-10-29 TW/US separation in the symbols pane and overview, plus US sectors from SPDR sector ETFs; the user's picks and the planned stack

2026-10-29, after #364–#369 merged, the user asked to separate Taiwan and US listings in the UI. Their picks (all my recommendations):

- Symbols pane: group by market automatically (全部／台股／美股 switch, 台股 and 美股 sections under 全部, drag reorders only within a market). Custom user-made groups were offered and not chosen.
- Overview: one 全部／台股／美股 switch in the page header shared by every tab, kept in the URL so the agent's links can name a market; the Market tab has no 全部, only 台股／美股.
- US Market tab: the 11 SPDR sector ETFs (XLK, XLF, XLV, …) stand for the S&P 500 sectors, read from Longbridge: heat map sized by the ETFs' value traded (labelled as the ETFs'), rotation against SPY, a row of SPY/QQQ/DIA/IWM; agent `get_sectors` covers the US. Sector movers and investor flows have no US source, so the US tab leaves them out.

Built 2026-10-29 as stack #370 (pane grouping, layout store `symbolsMarket`, shared `MarketFilter`) → #371 (overview `?market=`, `overviewMarket`, inbox never filtered, agent context/links name the market) → #372 (`UsSector`, `US_SECTOR_FUNDS`, `market.sectors({market})`, `get_sectors` market param) → #373 (US tab: `US_INDEX_FUNDS`, `SectorFundRotation` via listingRotations, `ListingsRotation` shows 'set up source' instead of Internal Server Error). Seen in a throwaway identity only; the US tab with live Longbridge data is unverified (needs the user's own identity, ask first).

**Why:** the user found TW and US items mixed together once US listings were added ([[solyx-us-stocks-research]]).
**How to apply:** keep Longbridge as the only US source; do not add custom watchlist groups unless asked.

2026-10-29 the user's live run of #373 showed the US tab's map refused by Longbridge ("request rate limit", 301606) and rotations as "Internal Server Error". Fixed apart from the stack as #374: the socket reads the quote profile (cmd 4) each connection and paces each command by its rate (burst caps it; default 10/s), counts at send time inside the 5-slot limit (it counted at queue entry, so held requests bunched), 1.1 s windows, retries 301606 after 1/2/3 s, batches quotes asked in one turn into one cmd 11 request (unlisted symbol fails the batch → each alone); backend keepMessages now keeps a stream's error message. Live rates for cmd 11/19 still unknown.

2026-10-29: #370–#374 merged into develop. US 五檔 showed one level because Longbridge's free US LV1 gives NBBO only (LV2/Nasdaq TotalView is a paid Quote Store package). PR #376: the ladder shows as many rows as the US book has held (1–5, sticky per listing), 最佳買賣 with no totals at one row; Taiwan stays at five; book named per market (五檔 / 委買委賣). Not seen live.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-market-split.md`, type `project`).
