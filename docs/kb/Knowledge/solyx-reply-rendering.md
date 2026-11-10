---
type: fact
title: "Agent reply rendering: Streamdown kept; html fences are a canvas (renamed from views 2026-10-13) with an app-owned kit of marks; research panel draws natively; JS canvases deferred"
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

# Agent reply rendering: Streamdown kept; html fences are a canvas (renamed from views 2026-10-13) with an app-owned kit of marks; research panel draws natively; JS canvases deferred

On 2026-10-09 the user decided to keep Streamdown for agent replies after comparing t3code (react-markdown + server-side buffering, no client repair). #62 (tables), #63 (fade-in, `sep: "char"`) and #64 (static `html` fences in a sandboxed srcdoc iframe) followed.

On 2026-10-13 the user asked to rename the `views` skill to `canvas`, have the agent draw more, and put more charts in deep analysis. They approved this split ("研究面板用原生畫、聊天回覆用 canvas"):

- **Chat replies draw canvases.** #153 renamed views → canvas (skill, `AgentCanvas`, `agent.canvas.*`). #154 added the kit `agent-canvas.css` (bars, cols, shares, ranges, line: sized by CSS `calc()` from `--v`/`--max`/`--lo`… the markup gives, so the model places nothing), a `# Replies` rule to draw, and playbook lines in deep-analysis, portfolio-review and fund-research. The kit was my addition to their ask.
- **The research panel draws natively.** #156: valuation range with the last price from `quoteQuery`, and a strip of the forecast record. Report sections stay plain text, since an agent-drawn figure would bypass the quote check.

All three merged on 2026-10-13. The same day the user asked for revenue and EPS trends and approved reading them only while the research tab shows: #157 (merged since) adds the `fundamentals` IPC channel (`trends(symbol)`, computed in main by core's `statementMetrics` and `revenueTrend`) and three tiles in the panel.

Still open:

- How often a real model now draws was not measured: the smoke run used a stand-in model. It needs real conversations on the user's keys.
- Fundamentals cover Taiwan only (FinMind), so US listings and funds show no tiles. Balance sheets, cash flows and dividends are kept in main but undrawn; so are calibration buckets and stance spells in `Coverage`. Since then calibration and stance history are drawn (`calibration-chart.tsx`, `stance-history.tsx` in `apps/webapp/src/modules/research`, #252 and #253), and US statements are read from Longbridge (#367; the tiles on a US listing were not checked in a run).
- Canvases that run JS (separate custom-protocol origin with its own CSP) stay deferred until static HTML/SVG proves insufficient.

**Why:** the user wants richer output without weakening the renderer's no-network, no-eval boundary, and numbers a reader can trust.
**How to apply:** new chart forms for replies go into the kit and the `canvas` playbook together (a desktop test fails when they part); figures over data the app keeps go into the panel as components. Verify in the app with [[solyx-isolated-smoke-run]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-reply-rendering.md`, type `project`).
