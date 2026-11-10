---
type: fact
title: "2026-10-17 ETF NAV and costs from SITCA opened as #189 (+ delisted-fund fix #188); mutual funds dropped by the user; no NAV history since the scheduler may not prefetch"
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

# 2026-10-17 ETF NAV and costs from SITCA opened as #189 (+ delisted-fund fix #188); mutual funds dropped by the user; no NAV history since the scheduler may not prefetch

On 2026-10-17 the user asked whether Solyx had data on Taiwan ETFs and mutual funds. After my evaluation they decided to do ETFs only. They agreed mutual funds are of little value, since the app cannot order them and open data has no NAV history or holdings.

**Opened 2026-10-17:** #188 and #189 both branch from `develop`, unstacked, and merge cleanly together.

- #188 `fix/delisted-funds`: `getFunds` drops funds missing from TWSE's `exchangeReport/STOCK_DAY_ALL`. That list also holds listings that did not trade. TWSE's `t187ap47_L` kept 31 delisted funds, and its delisting list names companies only.
- #189 `feat/fund-nav`: `@solyx/fundamentals/sitca` (`FundReportsProvider`). `get_fundamentals` shows the NAV, the same session's premium and the month's costs, and the `fund-research` skill was updated. README credits the Open Government Data License.
- #190 `feat/fund-premium-check`, stacked on #189: the skills now have the agent check a premium or discount above 1%, or unusual for that kind of fund, against the issuer's NAV history and quota notices before giving a view or a buy. The user chose this over storing history, since history would be patchy without scheduled reads. Retarget it to `develop` after #189 merges.

**Decision I changed from my own plan:** I told the user "折溢價歷史從開始抓的那天累積", but built no history. Accumulating it would need a scheduled read, and `apps/desktop/src/main/AGENTS.md` forbids prefetching on the scheduler. #189's body says so. Ask before adding read-time accumulation.

**Source facts not to re-derive:**

- SITCA `https://www.sitca.org.tw/MemberK0000/F/03/nav.csv` (data.gov.tw 11109, daily, newest day only) and `46443投信投顧公會境內基金各項費用資料.csv` (monthly; each ratio is the month's percent of net assets). It answers 406 to ky's `.text()` (`Accept: text/*`). `Response.text()` strips the BOM.
- Coverage: all TPEx ETFs and 222 of 241 TWSE ETFs. The 19 missing are futures-trust ETFs (TDCC 5-4 stale since 2026-08-25) and `…K` currency counters.
- TDCC OpenAPI `openapi.tdcc.com.tw/v1/opendata/<id>` covers offshore and futures-trust funds; SITCA also publishes domestic fund basic info (43476) and dividends (160547).
- Writing `\uFEFF` through the Write tool put a literal BOM in the source. Fix such files with a python replace.

Related: [[solyx-etf-data-sources]], [[solyx-commit-to-main]], [[solyx-stacked-pr-merges]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-fund-data-evaluation.md`, type `project`).
