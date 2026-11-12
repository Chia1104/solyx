---
type: fact
title: "Architecture refactor (11 deepening commits) merged as PR #10; the open item it left behind"
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

# Architecture refactor (11 deepening commits) merged as PR #10; the open item it left behind

The 11 deepening candidates from an architecture review (2026-10-04) were merged into `main` as https://github.com/Chia1104/solyx/pull/10; the branch `refactor/deepen-modules` is gone. The earlier PR #9, which also carried the news commits, was closed by the user.

Still open from that work: the user chose to give `OrderDesk` no quote feed yet, so market orders were rejected for lack of a reference price. Superseded 2026-10-18: PR #215 sizes market orders at the exchange's limit-up (see [[solyx-shioaji-roadmap-decisions]]).

**Why:** a later session may be asked about market orders or the quote feed and should know this was a deliberate deferral, not a bug.

**How to apply:** do not add a quote feed to `OrderDesk` unasked; raise it as an option when market orders come up. (Outdated since #215 and #221: market orders are sized at limit-up, and the desk checks a proposal's price premise at confirm.) See [[solyx-commit-to-main]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-deepen-modules-refactor.md`, type `project`).
