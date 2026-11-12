---
type: fact
title: "2026-10-21 terms of use + privacy policy as website pages /terms, /privacy (PR #276); user's choices: contact@chia1104.dev + GitHub Issues, ROC law, Taipei District Court, zh-TW prevails"
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

# 2026-10-21 terms of use + privacy policy as website pages /terms, /privacy (PR #276); user's choices: contact@chia1104.dev + GitHub Issues, ROC law, Taipei District Court, zh-TW prevails

On 2026-10-21 the user asked for a terms of use and privacy policy. Their choices: standalone website pages (`/terms`, `/privacy`, both locales; footer + desktop About + first-run Welcome link to them), contact `contact@chia1104.dev` plus GitHub Issues (they also said Discussions, but the repo has Discussions off — mention it if they enable it), Republic of China law with the Taiwan Taipei District Court. I chose: Traditional Chinese prevails. Opened as PR #276 (`feat/website-legal`), merged since.

**Why:** the privacy policy was written from what the code sends, and that differs from older copy: electron-updater sends a persistent random `x-user-staging-id` (root AGENTS.md says the feed "is sent nothing about the user"); Sentry reports carry the error message, device context and sessions (in-app copy names only versions); PTT news searches reveal held/watched listing names by default; ChatGPT sign-in sends the installation id; Fubon SDK logs hold the ID number; uninstall leaves data.

**How to apply:** when code starts sending something new, the privacy policy and its `updated` date change with it (rule in apps/website/AGENTS.md). The two copy mismatches above were flagged in #276, not fixed (Linear CHI-81; root AGENTS.md and the in-app crash-report copy still read the same on 2026-11-11). Related: [[solyx-website-docs-guides]], [[solyx-observability]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-legal-pages.md`, type `project`).
