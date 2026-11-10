---
type: fact
title: "Agent tools that help the user use and configure Solyx — get_setup + solyx-guide (PR #72) and change_setting (PR #73, stacked); decisions the user made"
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

# Agent tools that help the user use and configure Solyx — get_setup + solyx-guide (PR #72) and change_setting (PR #73, stacked); decisions the user made

On 2026-10-09 the user asked for an agent tool that helps them use and set up Solyx. Built as two stacked PRs:

- #72 `feat/agent-setup`: `get_setup` (read-only, per settings tab, secrets only as saved/missing), the built-in `solyx-guide` skill, and a prompt rule never to ask for secrets in chat. The agent links tabs as `#/settings?section=…` in its reply prose (the renderer navigates `#/` links in place) rather than with card buttons.
- #73 `feat/agent-change-setting`, based on #72: `change_setting` over an allowlist in `apps/desktop/src/main/modules/agent/agent-setup.ts`.

User decisions: `agent.decisionMode` may be changed both ways; `bypass` lets `change_setting` run unasked (no auto check, like remember/forget). The agent may change preferences but not anything that widens its own reach: keys, sign-ins, providers switched on, endpoints, shell, MCP policies, shared skills, memory.

**Why:** these choices came from the user, not the code; a later change could otherwise drop or widen them.

**How to apply:** #73 must be retargeted to `develop` once #72 merges (see [[solyx-stacked-pr-merges]]). New changeable settings go in the `changeables()` map, and the AGENTS.md rule in `apps/desktop` lists them.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-agent-setup-tools.md`, type `project`).
