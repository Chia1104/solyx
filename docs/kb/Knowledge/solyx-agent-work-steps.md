---
type: fact
title: "2026-10-27 chat redesign, open as PR #348 — each turn's work folds under one heading that animates the current step; tool calls show from when the model starts writing them (`tool:draft`)"
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

# 2026-10-27 chat redesign, open as PR #348 — each turn's work folds under one heading that animates the current step; tool calls show from when the model starts writing them (`tool:draft`)

On 2026-10-27 the user asked for three things in the agent chat: an outer Disclosure around each reply's steps, a heading that animates the current step, and a loading state on every step. Their example was deep analysis's report writing, which showed nothing until it was done. The cause: the model streams `revise_report`'s arguments for a long time, and the runtime forwarded only text and thinking deltas.

PR #348 (`feat/agent-work-steps`):

- **Wire.** `ToolCallStatus.Drafting` and a `tool:draft` event, which the runtime's `emitDrafts` sends once a streamed `toolCall` block has an id and a name. pi-durable runs the call under the same id (slot.callId = call.id), so the drafted row turns into the running one in place. Drafts still pending are dropped at the next `AssistantStart`. `RunEnd` marks a drafting call `Aborted`.
- **Webapp.**
  - `agent-turns.ts`: `threadTurns` keeps a turn's object while its items are unchanged, and `currentStep` puts a call waiting for approval ahead of one being written or run. A call holding a card (approval, proposal or MAGI, forecast, sector map, backtests) stays outside the fold.
  - `agent-turn.tsx`: the heading's step rises in through `step-in` on an outer span and shimmers through the `shimmer` utility on an inner span. Both on one span override each other's `animation`.
  - The done heading reads "N 個步驟 · 時間": user `at` → last reply `at`, formatted with `Temporal.Duration#toLocaleString` narrow.
  - `agent.doing.*` gives every tool a present-progressive label, because the en `agent.tools.*` labels are past tense.
- These were my picks, which the user has not reviewed: text said between calls joins the fold; calls with cards stay outside it; the fold starts collapsed even while the run goes.

Testing: the /tmp/solyx-docs2 kit's patch.mjs now accepts `scene.json` `{ "turns": [...] }`, where the reply to the request holding n tool results is `turns[n]`. A turn can carry `text`, `tool {name, input, draftMs}`, `textWait` and `firstWait`, so slow drafting can be watched. After `ab reload`, `ab eval` can read a stale page while screenshots stay right; verify from screenshots.

Related: [[solyx-card-redesign]], [[solyx-isolated-smoke-run]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-agent-work-steps.md`, type `project`).
