---
type: fact
title: "@ listing mentions and / skill commands in the agent composer: decisions taken 2026-10-10 and what the RAC Autocomplete spike proved"
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

# @ listing mentions and / skill commands in the agent composer: decisions taken 2026-10-10 and what the RAC Autocomplete spike proved

Design agreed with the user on 2026-10-10 for the agent composer's command input:

- `@` offers the listing on screen, then holdings, then the watchlist, each once. The token in the text is `@<code>` (`@2330`, `@NVDA`).
- `/` offers skills, but only those a SKILL.md frontmatter field allows as commands (the user chose that over listing every offered skill). The field is Claude Code's `user-invocable`, true by default; the built-ins `taiwan-market`, `us-market` and `views` set it false. The token is `/<skill-name>` at the start of the message.
- `@` opens a code wherever no letter or digit precedes it, so `比較@2330和@2454` works and addresses do not.
- Tokens stay in the message text. Main parses them against the watchlist, holdings and focus, and against the offered skills, then adds `mentions:` and `skill:` lines to `<app_context>`. The prompt tells the agent to `read_skill` a named skill first. IPC `send` stays unchanged.
- PR #75 (`feat/agent-message-commands`, opened 2026-10-10) holds the grammar in `./wire`, main-side resolution (`message-context.ts`), the context lines, the prompt rule and `user-invocable`.
- PR #76 (`feat/desktop-composer-commands`, stacked on #75) holds the composer menu (`agent-mentions.ts`, `composer-token.ts`, `composer-menu.tsx`), `messageParts` in `./wire` with `messageTokens` derived from it, the bubble chips (`message-text.tsx`), `AgentSkillInfo.userInvocable` and `/name` labels on the Skills tab. Retarget #76 to `develop` after #75 merges.
- Not yet verified live: names in suggestions and chips, a real Zhuyin IME, and the Held origin.

Spike on the local branch `spike/composer-autocomplete` (WIP commit e7ba493, not pushed; superseded by #76, safe to delete; files `composer-token.ts`, `composer-menu.tsx`, plus edits in `agent-composer.tsx` and the i18n catalogs). It proved react-aria-components' `Autocomplete` wrapping HeroUI `TextField`/`TextArea` works, under these constraints:

- Give the ListBox every candidate and filter through Autocomplete's `filter` prop. Filtering outside it leaves virtual focus on a removed node.
- Chromium fires `selectionchange` at the textarea without bubbling, so React `onSelect` misses caret moves. Listen on the element.
- `aria-activedescendant` lags typing by about 500ms by design. For Tab, read the option marked `[data-focused]`.
- With no ListBox mounted, Autocomplete attaches no key handlers, so Enter/Shift+Enter behave as before. Under IME composition (`isComposing`), Enter neither picks nor sends. Full-width `＠` triggers the menu and is written back as `@`.
- HeroUI's own `Autocomplete` is a Select with a search popover, so it does not fit a composer.
- The spike always sets `spellCheck=false` on the textarea, and name matching was untested (the throwaway identity has no market data).

Related: [[solyx-agent-setup-tools]], [[solyx-isolated-smoke-run]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-composer-commands.md`, type `project`).
