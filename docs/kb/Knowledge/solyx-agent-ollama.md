---
type: fact
title: Agent on Ollama — measured prompt size, Ollama's context default, the user's decisions (own /api/chat adapter, settings apart from embeddings), what was built 2026-10-17 on feat/agent-ollama
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

# Agent on Ollama — measured prompt size, Ollama's context default, the user's decisions (own /api/chat adapter, settings apart from embeddings), what was built 2026-10-17 on feat/agent-ollama

On 2026-10-17 the user asked whether pi supports Ollama for the agent, asked for a design, then chose: **B** (Solyx's own adapter for Ollama's native `/api/chat`, `num_ctx` per request) over a checked server setting, and **settings apart from embeddings** (`agent.endpoints.ollama`, secret `ollama-api-key`).

Facts behind it:

- The agent's first request is ≈17K tokens before any conversation (system ≈3.9K, 37 tools ≈12.9K), measured through a fake Anthropic endpoint.
- Ollama sizes context by GPU memory (<23 GiB → 4096); `/v1` cannot set `num_ctx`; overflow silently drops old messages. `/api/chat` takes `options.num_ctx`, `truncate: false`, `shift: false`; `/api/tags` carries `capabilities` and `details.context_length`.
- pi-durable compacts at `contextWindow − 16384`, so the window is 64K (capped at the model's) and models under 48K are not listed — Ollama's `qwen3` family (40K) is excluded; thinking maps to on/off only.

Built as PR #203 (`feat/agent-ollama` → develop, merged): `packages/agent/src/ollama.ts` (pi-ai `createProvider`, dynamic `fetchModels`), catalog `restore`/`refresh(providers)`/`servedByUser`/`listingFailure`, `fileModelsStore` → `userData/agent-models.json`, asked only once switched on. Smoke run against a fake `/api/chat` showed a full tool round trip. Not yet run against a real model (would need pulling one, e.g. `llama3.2:3b`; ask first) (Linear CHI-27).

Related: [[solyx-local-embedding-model]], [[solyx-broad-provider-support]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-agent-ollama.md`, type `project`).
