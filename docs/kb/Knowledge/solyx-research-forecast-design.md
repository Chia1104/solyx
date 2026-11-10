---
type: fact
title: Agreed design for solyx deep analysis — research reports plus scored forecasts behind one ResearchDesk; scope decisions the user confirmed
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

# Agreed design for solyx deep analysis — research reports plus scored forecasts behind one ResearchDesk; scope decisions the user confirmed

Design agreed with the user on 2026-10-07 for a "deep analysis" feature (inspired by `/Users/chia1104/Documents/GitHub/kansoku`, whose prompts/skills must not be copied).

Merged into main as PR #12 on 2026-10-07 (squash). The user had asked for a separate branch and plain git rather than GitButler for this feature, which overrode [[solyx-commit-to-main]] for it; the repo is not set up for GitButler anyway.

Decisions the user confirmed:

- Research report (slow layer) and forecast (fast layer, scored) both in scope, behind one module `ResearchDesk` in `@solyx/core/research` (`revise`, `forecast`, `coverage`, plus an overall track record). Storage in a new `@solyx/db/research`.
- Runs inside the existing agent conversation (new tools `get_research`, `get_fundamentals`, `revise_report`, `submit_forecast`, built-in skill `deep-analysis`); no separate pipeline.
- `revise_report` and `submit_forecast` run without approval.
- Forecast horizon is counted in trading sessions, judged on daily bars; intraday forecasts out of scope. Scenarios are price bands on the horizon close (exclusive, exhaustive) so probabilities can be Brier-scored; each scenario carries a path drawn on the daily chart, stored by session offset, not date.
- Decisions models audit claims (`ClaimAuditor`), never predict prices; threshold needs an eval script first.
- Fundamentals source is FinMind (keyless by default, optional token in settings); Taiwan first. TWSE/TPEx open data was rejected because it serves only the latest period. PE is computed in core from candles and trailing EPS.

State as of 2026-10-07: slices 1–5 are built and merged — core research, db, agent tools and skill, chart overlay and research view, FinMind fundamentals with report staleness, and the claim auditor (weak claims are refused below `CLAIM_SUPPORT_LINE` 0.6, measured on Jev only). The FinMind token setting followed in PR #15. Left unbuilt, each reported to the user: ex-dividend handling, PE band and valuation range on the chart, picking past forecasts on the chart, and the optional slice 6 (news challenging a report's falsifiers). Fundamentals are kept in memory for half a day, not in `cache.sqlite`.

**Why:** kansoku's weakness is unscored scenario probabilities and an unstructured report; the user wants the forecast visible on the K-line and the report to take part in the forecast.

**How to apply:** when asked to implement or extend this, follow these decisions rather than re-asking; build in vertical slices (core + db, agent tools + skill, chart overlay, fundamentals, claim auditor). My own suggestions not yet confirmed by the user: one forecast per listing per session, horizon capped at 20 sessions, statutory filing deadlines as EPS effective dates.

## Review of 2026-10-12, built as a stack

The user asked whether deep analysis could be improved ("我們現在的深度分析能再優化嗎"), approved all six items I proposed ("好那你再幫我依照這幾項做調整"), and they were built as a stack and all merged on 2026-10-13:

- #115 `feat/deep-analysis-inputs` → develop: the playbook names `get_macro`, the exchange's P/B and yield as a valuation basis, and restrictions inside a horizon.
- #116 `feat/forecast-base-rates`: a forecast keeps the base rates of its own bands; the record's skill is 1 − Brier ÷ the base rates' Brier; tool `get_base_rates`.
- #117 `feat/forecast-distributions`: cash gone ex inside a horizon is added back before judging and in the base rates' moves; settles nothing while distributions cannot be read.
- #118 `feat/stance-record`: each stretch of a report's stance against the market's index (`BENCHMARK`, TW = `IX0001`).
- #119 `feat/peer-multiples`: a listing's exchange multiples against the median of its exchange industry class.
- #120 `feat/quote-provenance`: a new quote must stand, line by line, in a tool result or user message of the conversation.

The user chose the six items. The details were my picks and not put to them: 60 moves as the least for a base rate, overlapping spans as the moves, at most three band edges for `get_base_rates`, raw closes on both sides of the stance comparison, substring matching that drops spacing and punctuation for quotes, and exempting quotes the report in force already holds.

Left unbuilt and said so in the PRs: stock dividends, splits and capital reductions; a stance figure across listings; a report's valuation range scored against the price. Not run: the agent in a conversation with any of it, so how often a real model's quotes are refused is unknown, and the cost and time of a deep-analysis run are still unmeasured.

First real run after the merge, 2026-10-13, TW 3231: the agent called `get_base_rates` (475 moves, 26/36/38%), set 30/37/33% and kept four claims, so their quotes passed the provenance check at least once. Whether any call was refused first is in the transcript, which I did not read. Follow-ups on what that run showed are in [[solyx-magi-council]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-research-forecast-design.md`, type `project`).
