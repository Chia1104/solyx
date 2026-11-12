---
type: fact
title: "Exchange open data in Solyx: #102–#104 merged, #106→#107→#108 stacked plus #109, #110 open 2026-10-12; TWSE's websites forbid automated downloads, so NAV comes from issuer pages via the agent"
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

# Exchange open data in Solyx: #102–#104 merged, #106→#107→#108 stacked plus #109, #110 open 2026-10-12; TWSE's websites forbid automated downloads, so NAV comes from issuer pages via the agent

On 2026-10-12 the user asked whether `https://openapi.twse.com.tw/` could supply the ETF data the app lacks, then had it built in two rounds.

Round one, merged into `develop` that day: #102 (restrictions from TWSE and TPEx lists), #103 (fund profile in `get_fundamentals`), #104 (tick told from the code, `InstrumentKind` removed).

Round two, all merged into `develop` by 2026-10-12 ("當初評估還沒做的先幫我做好了，淨值與折溢價先試試 mis.twse.com.tw，成分股與費用率再幫我引導 agent 去查詢"):

- #106 `feat/exchange-multiples` → #107 `feat/exchange-calendar-events` → #108 `feat/market-closures`, stacked: one `ExchangeListsProvider` contract in place of one per list; the exchanges' P/E, yield and P/B in `get_fundamentals`; ex notices and shareholders' meetings on the calendar; `getSession` takes trading days, closures on the calendar.
- #109 `feat/agent-fund-research`, from `develop`: the `fund-research` skill and a root `AGENTS.md` rule on sources' terms.
- #110 `feat/insider-transfers`, from `develop`: a news source on the announcement channel.

**The user's decisions, and where I went another way:**

- NAV and premium: the user said to try `mis.twse.com.tw/stock/data/all_etf.txt`. It parses (359 funds), but I did not wire it in: TWSE's terms of use (`www.twse.com.tw/zh/terms/use.html`, the same text inside the MIS site) forbid downloading the site's data by automated devices, scripts or crawlers without the exchange's consent, and `mis.twse.com.tw/robots.txt` is `Disallow: /`. This was reported to the user, not yet answered then. Do not build it unless they say so knowing this. Settled since: root `AGENTS.md` forbids reading TWSE's websites, and NAV comes from SITCA's open data (#189, [[solyx-fund-data-evaluation]]).
- Holdings and fees: the user chose guiding the agent to look them up. NAV and premium went into the same skill, read from the issuer's own pages.

**Why:** the terms finding is what a later session would otherwise miss and build anyway.

**How to apply:** facts worth not re-deriving:

- TWSE OpenAPI (`openapi.twse.com.tw/v1`, spec `/v1/swagger.json`, 143 endpoints, Swagger 2.0, no response fields declared) and TPEx's (`www.tpex.org.tw/openapi/v1`, spec `www.tpex.org.tw/openapi/swagger.json`, 225, OpenAPI 3.0, fields declared on all) take no parameters: each answers today's snapshot for the whole market. Keys mix Chinese and English, dates are ROC, values padded strings, and a list with nothing may answer one row with an empty code.
- A list can drop rows silently: TPEx writes an unannounced dividend as `尚未公告`, which first cost 55 of 73 notices. After adding a list, read it live and compare rows read with rows answered.
- Neither exchange's open data, nor FinMind, carries an ETF's NAV. TPEx has no list of funds (`/tpex_opfund_*` is its open-ended fund platform). FinMind's `TaiwanStockActiveETFHolding` has actively managed ETFs' holdings but needs a paid plan (free answers 400).
- FinMind publishes OpenAPI 3.1 at `api.finmindtrade.com/openapi.json`. Its `TaiwanStockTradingDate` already lists trading days through the year's end, so TWSE's `holidaySchedule` only names closures; it covers the current year and also lists weekends and first and last trading days.
- `PAPER_LIMITS` allows every session, so the desk's session check refuses nothing today.
- Not read yet: `t187ap13` (transfers declared and not made), `t187ap02_L` (holders above 10%), `t187ap38_L` (proposed dividends, TWSE only). Read since: attention stocks (`/announcement/notice`, #222) and `t187ap09_L` (directors' pledges, #225), both in `packages/fundamentals/src/tw-exchanges.ts`.
- Seen 2026-10-12: `www.stat.gov.tw` fails from Node and curl, so the macro calendar read nothing; cause and fix are in [[solyx-calendar-sources]].

Related: [[solyx-agent-autonomy]], [[solyx-calendar-sources]], [[solyx-investor-flows]], [[solyx-test-run-quirks]], [[solyx-isolated-smoke-run]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-etf-data-sources.md`, type `project`).
