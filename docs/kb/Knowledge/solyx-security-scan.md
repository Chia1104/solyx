---
type: fact
title: 2026-10-22 Claude Security scan of backend + trading core; findings filed as 8 private draft GHSA advisories, not public issues
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

# 2026-10-22 Claude Security scan of backend + trading core; findings filed as 8 private draft GHSA advisories, not public issues

2026-10-22 Claude Security scan (medium, scope: desktop main/preload/utility/worker + packages agent, core, brokers, backup; revision 4577c24). 10 verified findings, 8 distinct issues. Report in `CLAUDE-SECURITY-20261022-092804/` (gitignored).

Filed as private draft security advisories on Chia1104/solyx, by the user's choice over public issues (repo is public):

- GHSA-5cp3-xjx7-vr92 (medium): auto-mode shell judge reads only first 12,000 chars (`packages/agent/src/shell.ts:89`)
- GHSA-gxfp-jc3v-fxxm: `remember` saves/overwrites memories unasked in auto
- GHSA-w6w3-5g5p-m2rw: backup restore resets mandate daily budget (`order-desk.ts` #mandateDay)
- GHSA-gfcj-43w8-xw9x: no Electron fuses, hardenedRuntime false
- GHSA-5j2w-q73w-428c: shared-skill opt-in keyed on declared name
- GHSA-f49j-jv54-gh98: sign-in callback honors unauthenticated `error`
- GHSA-cjqm-5prm-f6w5: backup thinning deletes other installations' keys
- GHSA-rjw8-37p7-8qp7: unbounded backtest rule tree on main thread

Fixes opened 2026-10-22 as independent PRs against develop, unmerged: #277 shell judge, #278 shared skills, #279 sign-in callback, #280 memory, #281 backup thinning, #282 mandate day (counts the broker's tagged orders the store lost; fails closed as `day-unknown`), #283 backtest bounds, #284 fuses + hardened runtime + stable/nightly quit on `--remote-debugging-port` (user's choice: only `vp run package:test` "Solyx Test" keeps CDP). The user wants the advisories published after the fixes merge and ship; fill in the patched version then. Unverified: real Fubon SDK under hardened runtime, Windows, CI DMG.

**Why:** public issues would disclose unfixed vulns in a shipped app.
**How to apply:** file security findings as draft advisories, not issues; out of scope still unscanned: renderer, website, other packages. Plugin subagents fail with "synced for another account" when the user switches Claude accounts.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-security-scan.md`, type `project`).
