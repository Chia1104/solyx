---
type: fact
title: "2026-10-29 Paseo-style layout — title bar folded into the columns' headers, hairlines between columns, cards kept; built as PR #382; Windows tabs scroll at default width"
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

# 2026-10-29 Paseo-style layout — title bar folded into the columns' headers, hairlines between columns, cards kept; built as PR #382; Windows tabs scroll at default width

On 2026-10-29 the user asked for another webapp layout redesign after a Paseo screenshot: fold the window's title bar into the three columns, part the columns with the old hairlines again (as before #344), and keep the cards inside each column. They saw my mockup, said the direction was good and asked me to try it without picking between my two open questions, so I went with my recommendations: the global items go into the symbols pane, and all three columns share one ground.

Built as PR #382 `feat/webapp-column-headers` (into develop, open):

- No `TitleBar`. `ColumnHeader` is the window's top row (`app-drag`, insets `--column-start`/`--column-end`), with `.broker-rule` under it, driven by `data-broker-mode` on `BrokerModeScope` in `RootLayout`.
- `WindowControls` (absolute): symbols toggle and back at top-left, agent toggle at top-right. The column at each end takes `--chrome-start`/`--chrome-end` in `styles.css`.
- Symbols pane: search, Overview and Strategies (`PANE_LINK`, shared with the settings nav), then the market filter and the lists. `SymbolsPaneFoot` holds update, sessions, broker chip, lock and settings. Its empty header is hidden while floating.
- `Page` scrolls under its own header (`data-page-body`, the router's `scrollToTopSelectors`). Route errors and not-found get a `PageFallback` header.
- `tableColor`, `--table` and `board` were removed; `--radius-board` became `--radius-tray`. The window paints `colors.background`.
- Docs (en and zh) and the agent's skill text now say "left column" instead of "title bar".

Second round, the same day, pushed to #382 as bc3be5c3. The user asked for: the overview to scroll (its `Tabs` lacked `h-full`), a `StatusBar` along the window's bottom holding paper/live, the lock, sessions and update, with room kept for provider statuses later (not built), and Arc-style watchlist categories (`app/symbol-categories.tsx`: the category's name over the lists, `CategoryDots` at the pane's foot beside settings, a slide in from the dot's side, All/TW/US over `symbolsMarket`; user-made categories later, not built). They also asked for a paler ground on panes shown on hover: `floating` is now `surface-secondary`, and fields inside take `--surface`, since the field's colour matched that ground by night. I read "下排新的區塊" as a window-wide status bar and "panel hover 時的底色" as the floating pane; the user hasn't confirmed either.

Third round, pushed to #382 as 7308509c:

- A two-finger swipe (wheel deltaX, 60px, settled after 200ms by pacer) moves one category.
- Right-clicking a dot opens a react-aria `Popover` + `Menu` styled with `dropdownVariants`. I didn't use HeroUI's `Dropdown`, since `MenuTrigger` would also open on the dot's own press, and `ContextMenu` is HeroUI Pro. The menu's one section picks `CategoryIcon` into the layout store's `categoryIcons`; rename and delete come later, with user-made categories.
- Status bar: sessions on the left, then update, chip and a 24px lock on the right.
- The settings view lost its back row and foot, and the window's Back leaves settings, to `/` when there's no history; `useLastPage` was deleted.
- The top row's tabs and the market filter share `SEGMENT`/`SEGMENT_TRACK` in `components/segment.ts`; the filter sits on a `bg-default` track like the tabs.

Unseen or left open: real Windows (only simulated; at the default 380px agent width HeroUI's tab scroller takes over), drag regions not tested by hand, and the docs' app screenshots, which need retaking (ask before an R2 upload).

Related: [[solyx-card-redesign]], [[solyx-isolated-smoke-run]], [[solyx-website-docs-guides]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-layout-hairline-headers.md`, type `project`).
