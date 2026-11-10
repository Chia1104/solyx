---
type: fact
title: "2026-10-27 webapp redesign from hairline columns to cards (table, sheet, floating), with closed side panes that peek over the page on hover (Aside-style); #344/#345 merged; divider sweep #347 open; docs shots left"
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

# 2026-10-27 webapp redesign from hairline columns to cards (table, sheet, floating), with closed side panes that peek over the page on hover (Aside-style); #344/#345 merged; divider sweep #347 open; docs shots left

On 2026-10-27 the user asked to drop the hairline-ruled layout for card blocks, and for collapsed side panes to float over the page on hover, after the Aside browser. The user picked: docked panes stay on the table, not on sheets; build steps 1 and 2 first and look before going on; open a pane both from the edge and from its toggle.

Built as a stack:

- **#344 `feat/webapp-sheets`** (into develop): the `sheet` utility (an inside outline and no shadow) and `--radius-sheet`. `Page`/`PageColumn` replace `Sheet`/`RailedColumn` in `components/page.tsx`, and every `Section` is a sheet. The symbol page's chart, book and lower panel are three sheets. `PaneSplitter` sits in the gap a pane keeps. The open listing or settings section is a small sheet. The agent pane's and the overview's tabs are segmented.
- **#345 `feat/webapp-pane-peek`** (base #344): `app/pane-peek.ts` tracks the pointer with document `pointerover` in capture and in bubble, around React's `onPointerOver`, so the portals of menus the pane opened count as inside. Pressing outside dismisses through capture, since the Lightweight chart stops its events. Escape is caught on the document. The `floating` utility adds a drop shadow in dark mode. `workspace.pin` copy was added.

On 2026-10-27, second round, the user asked for the middle to be a card holding the sheets, and for every gap to be one size and aligned. It landed on #344 as commit 5f3cec45 and was merged up into #345:

- The window is `--table`, from `tableColor` in `@solyx/api/palette`: 6% toward the foreground by day, 35% toward black by night. Electron's `main-window.ts` paints its background and title bar overlay with it.
- The routed page lies on a `board` (`--background`, `--radius-board` 18px, which is the sheet's 10px plus the 8px gap), with `px-2 pb-2` and its header row flush at the top.
- One 8px gap separates every surface, and text sits 16px inside whatever holds it.
- Pane rows run to the pane's edge. A floating pane gets `p-2` and rounds like the board.
- #344's title dropped its scope, since the change now spans api, desktop and webapp.

The user merged #344 and #345 on 2026-10-27; both are on develop as cc6c3942 and e97fd1fb. The tab track radius fix (`calc(var(--radius) + var(--spacing))`) went in with them.

Third round, 2026-10-27, is PR #347 `feat/webapp-sheet-dividers`, merged since:

- Space parts rows inside sheets and panes: `SettingsList`, the inbox, headlines, themes, calendar lists, orders, fills, holdings and backtest history.
- A news row takes a rounded inset on focus.
- A new `well` utility (`surface-secondary`) holds the holding beside the book, the backtest trades, strategy cards, palette cards and the editor, agenda days at first; the user then asked for them to look like toggle buttons, so they are now HeroUI `ToggleButton`s in an `isDetached` group (commit 9e6a82a6), with the accent-soft fill when picked and a provider tile that is switched off.
- `ProposalItem` is a sheet wherever it shows.
- `ring-background` and `bg-background/x` knock-outs on sheets are now `surface`.
- Kept on purpose: pencil dashes, chart axes, a settled forecast's edge, MAGI, HeroUI fields, tables and menus (popover search dividers included), and the markdown blockquote and hr.

Left: retaking the docs' app screenshots, about 200 on R2 at assets.usesolyx.trade in en and zh, light and dark (Linear CHI-20). #347 is merged; ask the user before uploading, since it publishes and needs their R2 credentials.

Testing notes: the /tmp/solyx-docs2 kit (main.mjs wrapper, patch.mjs fake Fugle, `vp exec node seed.mjs zh`, shot.sh and secret.sh helpers on CDP 9340) still works. Make the folder "~/Library/Application Support/Solyx Docs Dev" before seeding. `save_secret "API 金鑰"` sets the Fugle key, and the Anthropic key row also needs saving. A covered window does not advance CSS transitions, so `getComputedStyle` visibility reads stale until a screenshot. The identity was removed after this run.

Related: [[solyx-isolated-smoke-run]], [[solyx-stacked-pr-merges]], [[solyx-website-docs-guides]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-card-redesign.md`, type `project`).
