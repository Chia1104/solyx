---
type: fact
title: 2026-10-27 settings sidebar regrouped into folding groups on branch feat/settings-nav-groups; the grouping and renames were my picks, which the user may change
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

# 2026-10-27 settings sidebar regrouped into folding groups on branch feat/settings-nav-groups; the grouping and renames were my picks, which the user may change

On 2026-10-27 the user asked for the settings sidebar to be regrouped with folding groups, since the old flat list had fallen behind the features. Their example: the sandbox sat under Skills but also governs strategies' code. They left the design to me. Committed on branch `feat/settings-nav-groups` and opened as PR #343 into develop on 2026-10-27, merged since.

These were my picks, so the user may change them:

- 一般 stands alone at the top and 關於 at the bottom. Between them are the groups 交易 (行情, 券商, 下單), Agent (模型, Skills, MCP, 記憶, 排程), 新聞與研究 (網路搜尋, 決策模型, 新聞合併, 主題), 安全 (程式執行, 裝置) and 資料 (儲存空間, 備份).
- The AI Agent tab was split into four tabs: models, web search, the decisions model and embeddings. 交易 was renamed 下單 (`orders`), so it no longer shares its group's name. Shell and the sandbox moved to a new 程式執行 tab (`code-execution`), with its own `settings.codeExecution` procedure.
- Folded groups persist in localStorage (`solyx.settings-groups`). Opening a section reopens its group.

Round 2 (same day, same branch): the user asked for an Observability section and for modals on long edits. 可觀測性 holds OTLP and sits below the groups, beside 關於. My call was to leave crash reports in About. `EditorModal` + `EditorFooter` (`components/editor-modal.tsx`) now hold the task, collection, theme, memory and mandate editors and the MCP server details, which used to be a sub-page through `?server=`. Kept inline: one-value rows and the palette editor, which previews across the whole window.

Round 3: `OptionSelect` takes an icon per option. Brand logos go on the provider selects, plain icons on sign-in method, decision mode, schedule kind, days and approval. MAGI carries the user's `nerv.svg` as a text-coloured mask, kept out of red by the red/green rule.

Docs and all 64 settings shots were updated in the same PR on 2026-10-27, along with an en plural fix for Fubon's account count ([[solyx-website-docs-guides]]).

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-settings-nav-groups.md`, type `project`).
