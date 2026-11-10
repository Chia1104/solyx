---
type: fact
title: "2026-10-19 plan to bring Shioaji Pro's order-entry UI into Solyx (quote board, 五檔, symbol-page ticket, chart overlays, positions dock, 分時); user picked right rail, stream-else-poll, drop the old form; stack #244→#245→#247→#248→#249 built 2026-10-19"
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

# 2026-10-19 plan to bring Shioaji Pro's order-entry UI into Solyx (quote board, 五檔, symbol-page ticket, chart overlays, positions dock, 分時); user picked right rail, stream-else-poll, drop the old form; stack #244→#245→#247→#248→#249 built 2026-10-19

On 2026-10-19 the user asked how Shioaji Pro's buy/sell UI flow and its trading charts could be integrated into Solyx. This was analysis only and nothing was built. AGPL applies, so only concepts are taken.

**Proposed order, one PR each, stacked:**

1. Quote board plus 五檔. Fugle `intraday/quote`, which `fugle-api.ts` already calls, returns five bid/ask levels and other fields Solyx does not parse yet: OHLC, avgPrice, `tradeVolumeAtBid`/`tradeVolumeAtAsk` (內外盤), limit flags, trial and halt.
2. An order ticket on the symbol page that replaces `ProposalForm`/`ExitForm` in the Proposals tab.
   - Steppers move by `twTickSize`. Quick prices: 跌停 / 平盤 / 現價 / 漲停. Quantity presets, plus "all sellable" from `Position.sellable`.
   - It shows a cost estimate.
   - 「檢查委託」 proposes with `source: User` and shows the `ProposalItem` inline, where the user confirms. Editing any field dismisses that proposal.
3. Chart overlays: average cost, working orders in ink, pending proposals in pencil, exit legs, fill markers and limit bands. A one-shot 點價帶入 mode.
4. A positions / working orders / fills dock with P&L columns and buttons that prefill a sale or an exit. The order lock moves to the title bar.
5. A 分時 view: a baseline series against the reference price plus VWAP. `Series` takes any `SeriesDefinition`, so `trading-chart` needs no change.

**Rejected, since each sends or changes an order in one click and so breaks invariant 1:** the flash ladder, chart click-to-send, the grid ticket, one-click close or reverse, double-Esc cancel-all, and dragging an order line to re-price. Also rejected: docking and pop-out windows, multiple accounts, and the tick tape and book heatmap, which need extra stream slots.

**Constraint:**

- **Stream cost:** Fugle counts each symbol × channel as one subscription, and the basic plan allows 5.
- **Book refresh:** a `books` stream for the open ticket's symbol uses one slot. The fallback is polling REST, which shares the basic plan's intraday budget of 60 requests a minute.
- **Rule change:** main AGENTS.md says quotes never use the stream, so streaming the book changes that seam.

**The user's picks (2026-10-19):**

- The ticket goes in a right rail on the symbol page.
- 五檔 streams and falls back to polling: the stream when there is room, else REST every 5 s in the regular session.
- Drop the free-text proposal form now. No Cmd+K palette for now.

**Progress:**

- **#244 (`feat/quote-book`):** quote board and 五檔 rail.
  - `Depth` type, `getDepth`/`watchDepth`.
  - `streamSymbols` renamed `streamSubscriptions`.
  - The `live-stream` holder is shared by the candles and `live-depth` hubs.
  - New procedures: `market.depth` and `market.band`.
  - The rail is hidden when the main view is under 52rem.
  - Smoke run with a faked Fugle WebSocket passed.
- **#245 (`feat/order-ticket`, stacked on #244):** `OrderTicket` sits in the rail.
  - **Two tabs:** buy/sell, and stop/target.
  - **Price:** follows the last trade until the user sets it. `stepTicks` in core moves it by ticks, and a price can be picked from the book via `useTicketStore`.
  - **Costs:** `twTradeCosts` in core.
  - **Proposals:** "檢查委託" proposes and shows the proposal inline as a `ProposalItem`. Any edit dismisses a proposal still waiting.
  - **Rail:** a toggle above the chart opens and closes it; the 52rem hiding was removed.
  - **Removed:** `ProposalForm` and `ExitForm`.
- **#247 (`feat/chart-trades`):** `TradeOverlay`, which draws on a carrier line series.
  - **Ink:** average cost, working limit orders and watched exits.
  - **Pencil:** proposals still waiting.
  - **Also drawn:** session limits, plus fill arrows from the new `account.fills` procedure.
  - **點價 toggle:** picks the next click's price via `nearestTick` in core.
- **#248 (`feat/account-dock`):** a `LowerView.Account` panel.
  - **Tabs:** holdings (P&L via `positionValue`, watched exits), working orders, and the 50 newest fills.
  - **Row actions:** 賣出 / 停損停利 fire a `useTicketStore.requestSale` request and open the listing's panel prefilled.
  - **Order lock:** moved to the title bar as `OrderLockToggle`.
- **#249 (`feat/session-chart`):** `SessionChart` (`chart=session`).
  - Baseline around the depth's reference, with a symmetric autoscale.
  - VWAP and volume panes.
  - Axis held open to the close; the agent sees it as 1m bars + VWAP.
- **#250 (`feat/trade-pane`, 2026-10-20), the user's redesign request:**
  - **Order panel:** moved into the agent pane's Proposals tab, relabelled 交易/Trade, above the queue. `useTicketStore.symbol` is set by the symbol page; elsewhere the user types it.
  - **Fields and drafts:** price and quantity use the same `NumberField` with built-in steppers, the price stepping by `tickSize` (so `stepTicks` was removed). Picks are a HeroUI `ButtonGroup`. A pencilled draft box replaces the inline proposal card.
  - **Symbol page:** the header shows the live price from depth. The rail holds the book plus `ListingPosition`. `LowerView.Orders` scopes orders and fills to the listing. `AccountPanel` was removed.
  - **Follow-up commit (same PR, user's review):**
    - The rail sits in the chart's row; its width is `bookWidth` in the layout store, resized by a splitter. The news spans the full width.
    - The watch star, the pick crosshair and the book bars are icon toggles; pick and book share one `ToggleButtonGroup`.
    - On the symbol page the ticket reads the route via `useMatch` and hides the code field. Elsewhere the tabs stay `inert` until `market.listing` finds the code.
    - A proposal's rationale is clamped and opens in a `Modal` (`proposal-rationale.tsx`).
  - **Second follow-up (same PR):**
    - The symbol page has one header row; `IntervalSelect` is a button with a popover.
    - The right pane's tab list is its header (HeroUI's secondary tab styles need `Tabs.ListContainer` as a direct child of `Tabs`). The tabs are 對話 (`chat`), 交易 (`proposals`: pending, working, fills, history), 買賣 (`ticket`) and 損益 (`profit-loss`). Session controls show only on chat.
    - I read the user's "對話及管理、交易、買賣跟損益" as those four tabs.
- **Merged:** #244–#250 into develop by 2026-10-20.
- **#251 (`feat/hold-to-confirm`, 2026-10-20):** hold-to-confirm on the proposal button, after a video the user sent.
  - `HoldButton` uses a 1.2 s clip-path ink wipe. Only release ends a hold, because a reflow moved the button out from under the pointer in a smoke run.
  - A virtual press confirms at once.
  - The website demo mirrors it.
- **#256 (`fix/ticket-shortcuts`, 2026-10-20, merged the same day), after the user reported 損益's 賣出 on another holding trading the page's listing:**
  - **User's picks:** a holding's 賣出/停損停利 always opens that listing's page, from any page. The order panel keeps its drafts across the pane's tabs.
  - **Built:** `useOpenSale` navigates (`search: true`), or only shows the panel when that page is already open, since the defaults-filled URL pushed a duplicate entry. The ticket tab is force-mounted (`data-inert:hidden`), both modes stay mounted, and the mode lives in `useTicketStore`. Depth is followed only while the panel is in view. A sale request `form.reset`s to a limit at the last price. There is an odd-shares hint.
  - **Reproduced on develop:** a stale request filled a sale in later, and a book pick made while 對話 showed was dropped (the panel mounted after it).
  - **Seen, left alone:** `search: true` from the overview carries `tab=today` into the symbol URL; symbol rows and the search do the same.
- **Merge order (old stack):** #244 → #245 → #247 → #248 → #249 → #250. Retarget each onto develop as its base merges.
- **Unseen:** whether Fubon's Normal mode offers `aggregates`; and whether Fugle's `aggregates` snapshots on subscribe (we seed with a REST read anyway).
- **Band and the board:** `market.band` gives the band of the session an order goes to. After the close it is "–" until TWSE publishes the next limits, which is late in the evening.

Related: [[solyx-shioaji-reference]], [[solyx-trend-layers]], [[solyx-exit-plans-decisions]], [[solyx-live-trading-plan]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-trading-ui-plan.md`, type `project`).
