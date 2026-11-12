---
type: fact
title: "Menu bar / tray resident feature for Solyx: the user's decisions, the slice plan, and the stack #88 → #89 that built slices 1 and 2"
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

# Menu bar / tray resident feature for Solyx: the user's decisions, the slice plan, and the stack #88 → #89 that built slices 1 and 2

On 2026-10-10 the user asked how to design a menu bar resident feature and decided:

1. Native `Tray` + native menu first; a popover window may come later on left click, with the native menu staying on right click.
2. Leaving the Dock while no window is open is the user's own switch (`tray.hideDock`, default off), since it turned out to be small.
3. No prices or P&L in the menu bar for now.

My own framing, which the user did not object to: the tray is the visible proof the app still works for the user plus the way to what waits for them, not a second UI. Its menu never confirms an order or answers an approval (trading invariant 1); it opens the window instead. Tray, Dock and (later) launch-at-login settings stay out of the agent's `change_setting`.

Slice plan (each its own PR): (1) single-instance lock, tray with Open/Quit, staying open without a window, Dock switch; (2) a main-process module for "what waits for the user" (proposals awaiting confirmation, agent approvals, scheduled runs, update ready) driving the icon state, menu sections and navigation into the window; (3) OS notifications; (4) launch at login; (5) later: popover, a pinned quote.

Built on 2026-10-10 as a stack: #88 `feat/desktop-tray` (slice 1) and #89 `feat/desktop-tray-waiting` (slice 2, based on #88). The user asked for the commit and to continue ("先幫我 commit 再接續吧").

- #88 also moved the language preference from the renderer's localStorage into `appearance.language`, because the main process writes the tray's menu; #89 moved the time zone into `appearance.timeZone` and the clock formatter into `#shared/clock.ts` (now `packages/api/src/clock.ts`) for the same reason. Neither migrates the old localStorage value.
- #89 added `main/modules/workspace` (the main process asks a window for a place: proposals tab, a conversation, a settings section; the window takes it on a push and as it loads), `main/modules/agent/waiting-calls.ts` (conversations with a call waiting, from run events), and the menu's rows and count. Both modules sit under `packages/backend/src/modules/` since the backend split.
- Left for slice 3 on: OS notifications (Linear CHI-21; and a first-time hint on Windows that the app stayed in the tray), launch at login (Linear CHI-22), a changed icon on Windows and Linux, where nothing but hover text shows the count.

**Why:** these choices came from the user and the plan spans several sessions.

**How to apply:** continue from the next unbuilt slice; follow [[solyx-commit-to-main]] and [[solyx-stacked-pr-merges]] when committing. #88 and #89 are both merged. Unverified: a conversation waiting for approval, a running task and update rows in a real run (only tests); macOS notifications and login items under the ad-hoc signature (Electron 44 says notifications need a code-signed app), close-to-tray on Windows, and tray presence on Linux desktops without an indicator host. See [[solyx-isolated-smoke-run]] for how the tray was checked.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-menu-bar.md`, type `project`).
