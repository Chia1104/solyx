---
type: fact
title: User wants to rethink how solyx organizes scheduled work, modelled on t3code's scheduled tasks; paused 2026-10-08 before any design
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

# User wants to rethink how solyx organizes scheduled work, modelled on t3code's scheduled tasks; paused 2026-10-08 before any design

On 2026-10-08 the user asked how solyx should organize its scheduled work, using `/Users/chia1104/Documents/GitHub/t3code`'s scheduled tasks (interval / fixed_time / webhook, runs bound to a thread) as the reference. They stopped the investigation before the t3code side was mapped and said they will discuss it later.

**Why:** a later session will likely pick this up and should not restart from zero or assume a design was agreed.

**How to apply:** nothing is decided yet. What was established then: pi-durable's `TaskScheduler` only runs pending durable tasks and has no run-at-time primitive, so time-based scheduling would be the app's own layer. The t3code architecture still has to be read. Related: [[solyx-research-forecast-design]]

Superseded 2026-10-15: what was built since (interval / fixed-time / on-change tasks, collection plans, change scopes in PR #176) answers it, and the user approved un-pausing item 5 of [[solyx-workflow-review]] as its own PR instead of reopening this discussion.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-scheduling-discussion.md`, type `project`).
