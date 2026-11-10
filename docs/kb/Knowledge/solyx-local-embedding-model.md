---
type: fact
title: "Ollama model detection and in-app pull for local embeddings — PR #200 (2026-10-17), what was decided and left out"
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

# Ollama model detection and in-app pull for local embeddings — PR #200 (2026-10-17), what was decided and left out

On 2026-10-17 the user asked for the embeddings settings to detect whether Ollama holds the local model and offer to pull it. Opened as PR #200 (`feat/local-embedding-model` → develop).

Decisions I made (user accepted by asking for the PR): pull through Ollama's `/api/pull` HTTP API rather than spawning `ollama` (Finder-launched apps lack the shell PATH); detect through OpenAI-compatible `/v1/models` so LM Studio reads right; the pull lives in the main process (one per model, progress pushed ≤2/s on `embeddings:changed`); the row polls every 5s while missing/unreachable.

Left out: a cancel button; pulling for non-Ollama servers (LM Studio gets a failing pull). Not verified: a real download from Ollama's library (smoke run used a fake Ollama on 127.0.0.1:11435 set as `embeddings.local.baseURL` in the throwaway config, see [[solyx-isolated-smoke-run]]).

Follow-up the same day on branch `feat/embeddings-endpoint` (stacked on #200): the settings edit Ollama's endpoint and take an optional bearer key (secret `ollama-embeddings-api-key`, named apart from agent providers' `<id>-api-key`). The user decided: their own text (reports, memories, searches) may go to a host they run, with copy that names the host whenever the endpoint is not loopback; and the key is wanted for hosts behind a token-checking proxy. The provider label became plain "Ollama". The pull now goes beside `/v1` so a proxy's path prefix holds.

Related: [[solyx-embedding-evaluation]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-local-embedding-model.md`, type `project`).
