---
type: fact
title: "Fallow 3.35.0 set up 2026-10-24 as PR #299 (chore/fallow-setup); user's picks, no agent hook after Strix's finding, global fallow-mcp, upkeep steps"
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

# Fallow 3.35.0 set up 2026-10-24 as PR #299 (chore/fallow-setup); user's picks, no agent hook after Strix's finding, global fallow-mcp, upkeep steps

Set up 2026-10-24 as PR #299 (branch `chore/fallow-setup`), open; four commits: setup, a hook hardening, the hook's removal, then the enum/CRAP tuning.

- User's picks: warn-default cleanup rules stay advisory; private-type-leak off; keep the enum convention, so `ignoreExportsUsedInFile: {type: true}` (an enum's exported type is often used only in its file); CRAP off (`health.maxCrap: 0`, coverage is only estimated), cyclomatic 20 / cognitive 15 still gate; CI `audit` job on pull requests blocks on a `fail` verdict (new-only gate, `FALLOW_AUDIT_BASE=origin/<base_ref>`, GitHub annotations).
- No agent commit hook: Strix (strix-security bot) flagged that a committed PreToolUse hook runs repo-controlled code on every agent shell call; pinning the handler to `$CLAUDE_PROJECT_DIR` did not answer it, so hooks, scripts and `.claude/settings.json` were removed. CI is the gate; agents run `fallow audit` themselves.
- MCP: `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json` run bare `fallow-mcp` from PATH, installed globally with `vp install -g fallow@<version>` by the user's choice. With fallow as a local dev dependency, `fallow agent install` writes `npx --no fallow-mcp`, which fails at the root with EBADDEVENGINES (pnpm `devEngines`).
- Skills are the pointer stubs fallow writes for a local install (read `node_modules/fallow/skills/...`). The generated `AGENTS.md` block was replaced by one rule; root `AGENTS.md` says `fallow agent install` runs with `--without hooks --without guide --without mcp`, which is a no-op today.
- Config is `.fallowrc.jsonc`, a comment per setting. Besides the policy above it holds what plugins miss and `ignoreExports` for the website's shadcn `components/ui`: package `scripts/`, test fixtures, Void/shaders configs as entries; website MDX as `dynamicallyLoaded` (fumadocs-mdx macro); `tools/oxlint/**` ignored as vendor; `@oxlint/plugins` and `@fontsource-variable/noto-sans-tc` (read by `require.resolve(variable)`) in `ignoreDependencies`. recommend's `entry` src/index|main and `workspaces.patterns` changed nothing, so they were dropped.
- Debt at setup: 17 unused exports, 17 unused types, 1 webapp router cycle, 37 clone groups, 281 health findings (224 CRAP-only). After the tuning, PR #300 (from develop) removed the 9 unused backend `ReturnType` aliases, made 10 in-file exports private, deleted `useListing` and broke the cycle (`showDestination(destination, navigate)`). The four follow-ups the user asked for on 2026-10-24 are PR #301 (core: `listingViolations`/`priceViolations`/`sellableShares`, `#lockedMeanwhile`/`#failed`) and PR #302 (webapp: `SectionLoadError` x14, `matching(endpointSchema)` for four endpoint fields, splits of ProposalItem, ApprovalCard, AgentModelPicker, OrderPanel, AgentComposer; smoke-run verified). Still over cognitive 15 by choice: OrderPanel 26, AgentComposer 36, useApprovalRequest 34, AgentModelPicker 23. Boundaries not configured; the renderer's no-network rule is a candidate.

**Why:** The user's choices and why the generated hook/guide/MCP forms were rejected are not visible from the files alone.
**How to apply:** On a fallow upgrade bump the `lint` catalog pin and the global install together, then re-run `fallow agent install` with the three `--without` flags. Related: [[solyx-test-run-quirks]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-fallow-setup.md`, type `project`).
