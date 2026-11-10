---
type: fact
title: Embedding/vector retrieval evaluated 2026-10-09; recommended FTS5 across all stored text first, embeddings later as hybrid; nothing decided yet
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

# Embedding/vector retrieval evaluated 2026-10-09; recommended FTS5 across all stored text first, embeddings later as hybrid; nothing decided yet

On 2026-10-09 the user asked whether to add embeddings to improve retrieval over stored data. Nothing was decided or built in that first answer; what followed the same day is below.

Facts verified that day (re-check before relying on them):

- Only `memory.sqlite` has text search (FTS5 `memory_terms` fed by `searchTerms`, BM25). Reports, forecasts, news and conversations are read by listing/date/id only; there is no conversation search tool.
- pi-ai 1.0.3 has no embeddings API.
- Electron 44.5.1 runs Node 24.21.0 / SQLite 3.53.4; its `node:sqlite` has FTS5 (trigram too) and `allowExtension` + `loadExtension` work, so sqlite-vec would load, but it is a per-platform native binary (no windows-arm64) against the root rule "ships no native modules".
- `@huggingface/transformers` 4.3.1 hard-depends on `onnxruntime-node` and `sharp` (native).
- Dev data volume was tiny: 1 memory, 8 reports, 8 forecasts, ~400 news items, 24 conversations.

My recommendation: phase 1 extend the FTS5 + `searchTerms` pattern to research, news and proposals with an agent search tool; phase 2 only after an eval shows misses: an `Embedder` port in core, an OpenAI-compatible `/v1/embeddings` module with its own key (covers Ollama/LM Studio), vectors as BLOBs, brute-force cosine in JS behind a SQL prefilter, RRF with BM25, FTS-only when no embedder is set.

Phase 1 merged into develop as PR #47 on 2026-10-09: FTS5 `report_terms`, `forecast_terms`, `news_terms` with on-open backfill, `ResearchDesk.search`, `NewsDesk.search`, agent tool `search_history` (`./history`), proposals ranked in memory, and `searchTerms` now keeps cased words whole (`CoWoS`) and drops lone Latin letters. The user wants embeddings later as an experimental, user-chosen switch for a local model; not started at that point (built below as #48 and #49).

Next the user wants embeddings for news dedup (story grouping). Decided 2026-10-09: decisions-model classification stays as it is; the experimental switch runs on an OpenAI-compatible `/v1/embeddings` endpoint, Ollama on 127.0.0.1 by default; do not pull models on the user's machine yet (their Ollama has only English models: nomic-embed-text, mxbai-embed-large, all-minilm). My proposed design, not yet approved: `Embedder` contract in core, `@solyx/embeddings` with one OpenAI-compatible module over ky, item-level vectors tagged by model in news.sqlite embedded during collect, a third grouping rule in `newsStories` (same voice, within a day, cosine above a per-model measured line, precision first), an eval script on synthetic labelled headline pairs (zh, en, cross-lingual, same-company hard negatives), hybrid `search_history` later.

Slice 1 built 2026-10-09 as PR #48 (branch `feat/embeddings`, rebased on develop after #47 merged): `@solyx/core/embedding` (`Embedder` with `space`, `cosine`), `storyText` in core news (title + first 500 chars of snippet), `@solyx/embeddings` (`./openai-compatible` over ky, `./provider` with Local/OpenAI defaults), `scripts/eval-stories.ts` on 37 synthetic pairs (19 same, 18 different). The user chose the secret `embeddings-api-key` and let me run the eval on their `OPENAI_API_KEY`. Results (precision-first line → same-language rewordings joined / cross-language joined): 3-small/512 0.84 → 3/11, 0/7; 3-small/1536 0.82 → 3/11; 3-large/3072 0.75 → 10/11; 3-large/1024 0.78 → 10/11; 3-large/512 0.80 → 10/11; cross-language 0/7 on every space. The current rules (via `readNews`) join 2/19 same pairs and wrongly join all 4 "same mould" pairs (other company, same headline template, e.g. 鴻海 vs 廣達 monthly revenue). OpenAI vectors shift ±0.002 between calls. OpenAI default set to text-embedding-3-large/1024. Local qwen3 not measured.

Real-data check 2026-10-09 (user approved sending dev news to OpenAI; 416 listing items, 11 TW listings, 3-large/1024, my own judgment of pairs, nothing committed): cosine alone at the synthetic line 0.78 joins 45 pairs the current rules miss, about 23 same / 10 different / 12 ambiguous, so the synthetic set overstated precision. The false merges were structural: daily templated data pages (三大法人買賣超, 0050 holdings), one site's series on different days (盤後解析), market wraps on consecutive days, different months' revenue. With guards (both items dated, same exchange day, different sites): 0.78 gives 21 same / 3 different / 6 ambiguous; 0.81 gives 12 joins, all same story. The current rules joined 164 pairs with no visible "same mould" false merge in this data. Suggested slice 2 rule: same voice + both dated + same exchange day + different sites + cosine ≥ about 0.82 on 3-large/1024.

Slice 2 is PR #49 (branch `feat/news-vectors`, base `feat/embeddings`, stacked on #48). The user pulled `qwen3-embedding:0.6b` into their Ollama. qwen3 measured: synthetic line 0.81 (7/11 rewordings); on real data generic 0050 investing articles read 0.877 alike, so its line is 0.89. `STORY_LINES` in core news is a Map: 3-large/1024 → 0.82, qwen3-embedding:0.6b → 0.89. Rule: same voice, both dated, same exchange day, different sites, cosine ≥ line (`comparableByVector` exported for `scripts/review-stories.ts`). Records carry `embedding?: { space, values }`; `item_embeddings` table keeps one space at a time; news module embeds missing items on collect/read; the symbol page now gets `news.reading` (grouped in main, vectors stripped) instead of `news.records`. Settings: `embeddings.enabled` (default off), `embeddings.provider` (local/openai), model/baseURL per provider in config.json only; secret `embeddings-api-key`; settings section "Group news by meaning (experimental)" on the Agent tab. Smoke-tested the settings section in a throwaway identity.

#48 and #49 were squash-merged into develop 2026-10-09; the five follow-ups were rebased with `rebase --onto` and opened as stacked PRs #51 (base develop) → #52 → #53 → #54 → #55, each based on the branch below; all five are merged since. Follow-ups: `feat/falsifier-watch` (ResearchDesk.watch reads falsifiers against nearest news with the claim auditor + CLAIM_SUPPORT_LINE; FALSIFIER_FLOORS qwen3 0.45, top 3 per falsifier; falsifier_checks table; get_research and research panel show signals), `feat/vector-search` (search_history fuses BM25 with vector ranking via fuseRankings/RRF; clearlyNearest keeps hits ≥ query mean + 0.12; passage_vectors cache by text; cross-language retrieval worked on real data, e.g. "data breach" → 104 履歷外洩), `feat/memory-vectors` (remember refuses a near-duplicate of the same kind/listing unless `distinct`; MEMORY_LINES qwen3 0.72 from eval-memories, repeats ≥ 0.744 vs different ≤ 0.690; recall by meaning; shared `db/src/vectors.ts`), `feat/headline-vectors` (rankHeadlines merges alike leads across listings), `feat/forecast-precedents` (deep-analysis skill: search past forecasts by argument; read falsifier signals). Decision taken without explicit user pick: the user's own text (reports, memories, queries) is embedded only by the local model; with OpenAI those features fall back to words. (On 2026-10-17 the user decided their own text may also go to a host they run, see [[solyx-local-embedding-model]].)

**Why:** the gap is missing retrieval paths, not lexical ranking; the agent can already rewrite queries across zh/en.

**How to apply:** if the user returns to this, start from these findings and ask which scenario they hit rather than re-surveying. Related: [[solyx-research-forecast-design]] (slice 6, news against a report's falsifiers, built here as #51), [[solyx-scheduled-work]] (backfill would be push-kind `ScheduledWork`).

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-embedding-evaluation.md`, type `project`).
