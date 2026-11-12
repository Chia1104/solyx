---
type: fact
title: "2026-10-27 PR #349 — the composer's attached listing became an Aside-style card inside it, in a sideways-scrolling row meant to hold files later"
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

# 2026-10-27 PR #349 — the composer's attached listing became an Aside-style card inside it, in a sideways-scrolling row meant to hold files later

On 2026-10-27 the user asked for Aside-style attachments in the agent composer: a card with a thumbnail, a title and a subtitle inside the composer, in a row that scrolls sideways, so file uploads could show there later. Built as PR #349 (`feat/composer-attachment-cards`, merged), in the new file `apps/webapp/src/modules/agent/composer-attachments.tsx`.

The design choices were mine, and the user has not reviewed them:

- **Thumbnail:** the listing's newest session (`QuoteLine`).
- **Text:** name as the title, "code · market" under it.
- **Remove button:** hidden until hover or focus, as in the watchlist, but always shown on `pointer-coarse`.
- **Detached listing:** keeps a muted card with "附加". It is not dashed, since dashes mean pencil.
- **Scrolling:** a wheel listener turns vertical wheel movement into horizontal scrolling.
- **Corners:** the composer moved to `rounded-board` with an 8px inset, so it nests `sheet` cards.

Not built: a separate card for the backtest run that rides along with the screen. File upload did not exist yet (it followed in #350–#354, see [[solyx-chat-file-upload]]). With only one attachment that day, overflow was checked by cloning cards in the DOM.

Related: [[solyx-card-redesign]], [[solyx-agent-work-steps]], [[solyx-isolated-smoke-run]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-composer-attachments.md`, type `project`).
