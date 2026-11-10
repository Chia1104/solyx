---
type: fact
title: 2026-10-19 user's picks for stop-loss/take-profit, Fubon sign-in placement and SDK version CI; build order 2 → 3 → 1
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

# 2026-10-19 user's picks for stop-loss/take-profit, Fubon sign-in placement and SDK version CI; build order 2 → 3 → 1

On 2026-10-19 the user approved all three follow-ups from the live trading discussion ("那就都做，先照這順序吧"), built in this order:

1. A Brokers settings section that holds Fubon's sign-in apart from the market-data source. Market data shows a status line plus a link to it, Trading offers "Set up Fubon", and onboarding gets no new step.
2. CI for Fubon SDK versions: download the public zip and `test_environment.zip` at runtime; type check, load under Electron, test-env assertions, daily new-version detection; the app warns about untested versions.
3. Exit plans (stop-loss / take-profit). The user's picks:
   - Fubon runs them as broker-side condition orders (`singleCondition` / `TpslWrapper` / `trailProfit`); paper simulates them in the app.
   - Every exit plan the agent proposes waits for the user's confirmation. A mandate attaching exits comes later, not now (Linear CHI-42).

**Why:** a stop must fire while the app is closed, and invariant 1 holds when the confirmed thing is the condition order itself.

**How to apply:** the work was stacked on #236 (`feat/fubon-account-pick`) and is merged since. Fubon's test environment was checked for condition orders before the design was fixed (the probe below). `ConditionOrder` has no `userDef`, so reconcile those orders by matching their content. Related: [[solyx-live-trading-plan]].

Probed in Fubon's test environment on 2026-10-19 at about 16:45, using the raw SDK (`/tmp/fubon-probe/cond.cjs`):

- **Condition orders are supported.** `singleCondition`, a buy with a `TpslWrapper`, `trailProfit`, `getConditionOrder`, `getConditionOrderById`, `cancelConditionOrders(guid)` and `getConditionHistory` all answered.
  - Dates are `yyyyMMdd`.
  - A start date of today is refused after 16:32 ("今日效期已過,限營業日當日上午8:30至16:32接受訂閱"), so a plan set in the evening starts the next trading day.
- **Records are human-readable text and must be matched by guid.** Fields such as `conditionContent` ("當自…內 富邦金成交價小於等於41.5元 全部成交為止") and `status` ("預約(N)", "未生效(W)" for TPSL children, "條件單已刪除(C)") are prose. `account` is the bare number, without the branch. The shared account lists other testers' condition orders, hence the guid matching.
- **TPSL attaches children** (`orderLevel` 1, `parentGuid`), and cancelling the parent deletes them.
- **Trailing orders may short.** A `trailProfit` sell reads "下單(當沖/次日回補)" and a TPSL sell child reads "下單(次日回補)", which may mean they can sell short. Prefer `singleCondition` sells; check that before using either of the others.
- **Quotes come from the SDK.** `querySymbolQuote` works in the test environment, but its reference price and limits are stale (2881 had ref 46, band 41.4–50.6, while the last price was 158.5). Price checks there must use the SDK's quote, not exchange data.

More condition-order findings (2026-10-19, about 17:15):

- `getConditionOrder(account, "Type2")` (尚有效單) lists the condition orders still in force; a deleted one drops out of it. Statuses: Type1 今日相關, Type2 尚有效單, Type3 條件比對中, Type4 委託處理中, Type5 委託成功, Type6 已通知, Type7 委託失敗, Type8 已有成交, Type9 刪除成功, Type10 異常, Type11 失效.
- **Validity cap:** the end date may be at most 89 days after the start; 90 is refused with "Conditional orders only support 90-day validity period."
- **Placement checks little:** odd lots (`IntradayOdd`, quantities in 股) and market sales are accepted, and so is a sale of a listing the account does not hold.
- **Filled volume is text:** `conditionFilledVolume` reads "0張" for board lots and "0股" for odd lots.

Shipped so far:

- Item 1 became PR #238 (`feat/broker-settings`, Brokers section).
- Item 2 became PR #239 (`feat/fubon-sdk-ci`), whose `fubon-sdk-check.ts` passed on GitHub's runners against the test environment.

Built 2026-10-19, stacked on #236 (all merged since):

- #238: Brokers section.
- #239: Fubon SDK workflow. Its PR runs passed on GitHub's runners, test environment included.
- #240: exits in core, the desk, the paper account and the UI.
- #241: Fubon condition orders.
- #242: the agent's `propose_exit` and the exit-plan skill.

Merge order after #236 was #238 → #239 → #240 → #241 → #242.

Design choices that were mine, not the user's:

- A stop sells at `LimitDown`; a target sells at a limit equal to the target.
- `MAX_EXIT_DAYS` is 60.
- The app cancels the second leg itself; while the app is closed, both legs could sell.
- No trailing exits and no TPSL children.
- No `OrderTooLarge` cap on exits.
- Exits skip the MAGI vote.
- The paper account checks prices only when asked: by the exit-watch pass each minute of a regular session, and at startup.

Not seen yet (Linear CHI-46):

- A Fubon leg actually triggering.
- Whether a real account needs Fubon's 條件單 agreement.

2026-10-19, later:

- **Codex reviews fixed and replied to on GitHub.**
  - #240: exits get the premise checks.
  - #241: a failed `singleCondition` answer is a refusal only when the conditions in force list no such leg placed since. A cancel counts only when its counts parse.
- **PR #243** (`feat/paper-exit-stream`, approved by the user):
  - The paper account follows live minute bars, using the hub's `liveCandles` stream that charts share.
  - A leg triggers on the first bar after placement whose low or high reaches it. It fills at the leg's price, or at the bar's open on a gap; a bar that reaches both sells at the stop.
  - `onExitSold` triggers `desk.brokerChanged`.
  - The once-a-minute check stays as a backstop, and only for listings the stream does not cover.
- **Smoke test** with a faked Fugle WebSocket in the wrapper's `main.mjs`, overriding `globalThis.WebSocket` with auth, subscribe, snapshot and `data` messages. It worked.
- **Merge order:** … #242 → #243; all merged since.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-exit-plans-decisions.md`, type `project`).
