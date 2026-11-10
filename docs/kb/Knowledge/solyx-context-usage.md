---
type: fact
title: "Agent context ring/popover, per-reply prompt-cache tokens and manual compaction (/compact), all in PR #78 (2026-10-10); what was deferred"
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

# Agent context ring/popover, per-reply prompt-cache tokens and manual compaction (/compact), all in PR #78 (2026-10-10); what was deferred

PR #78 (`feat/agent-context-usage` → develop) holds all of it, in three commits:

- `assistant:end` carries `ReplyUsage` (input, cacheRead, cacheWrite, output).
- The runtime sends a `context` event, pi-ai `estimateContextTokens` over `conversation.context()`, before each commit's events.
- The composer ring opens a popover with a ProgressBar and a compact button.
- `/compact [instructions]` is an `AgentCommand` in the wire grammar; it hides any skill of that name.
- Summaries show as a divider in the thread.
- A shared `renderer/components/expandable.tsx`, ported from the user's chia1104.dev `agent-elements` at their request, folds user messages (240px) and summaries (160px).

The popover and compaction were a follow-up request while #78 was still open and unreviewed, so I added them to #78 instead of stacking a second PR. That was my call, not the user's.

Deferred: cost display and conversation totals (the user asked only for the proposed scope), via pi-durable's `UsageDoc` / `usage_changed`. After a compaction the estimate leaves out the system prompt and tools until the next request.

**Why:** the user wants context use and prompt-cache records visible in the agent UI, and a way to compact by hand.
**How to apply:** build cost or totals on `UsageDoc`. pi-durable's own `estimateContext` is not exported, so don't reach for it. See [[solyx-isolated-smoke-run]] for the stub-endpoint check, which can answer pi's summarization request separately.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-context-usage.md`, type `project`).
