---
type: fact
title: "Solyx release setup decided 2026-10-07 — t3code-style scheduled nightly (per-merge until PR #101, 2026-10-12) and hand-dispatched stable promotion with GitHub-generated notes; choices the user made and what is unverified"
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

# Solyx release setup decided 2026-10-07 — t3code-style scheduled nightly (per-merge until PR #101, 2026-10-12) and hand-dispatched stable promotion with GitHub-generated notes; choices the user made and what is unverified

Decided 2026-10-07 (first pipeline commit 60932da, reworked in PR #17). The user's choices, not derivable from the workflows alone:

- Modelled on t3code's flow (studied its release.yml). Until 2026-10-12 nightly published on every push to `develop` after CI; that day the user asked to move it to a schedule "like t3code" (PR #101: half-hourly poll, six-hour gap, newest CI-passed commit, manual dispatch skips the gap). The six-hour gap and half-hour poll are t3code's numbers that I carried over, not ones the user stated.
- Notes: GitHub-generated from PRs; no CHANGELOG file. release-please was tried and rejected (user closed its Release PR #16); Changesets/Tegami were considered and rejected as package-oriented.
- Stable: dispatched by hand, promotes the latest nightly's commit, version defaults to the nightly base (patch+1), overridable.
- Nightly is a separate app "Solyx Nightly" (`dev.chia1104.solyx.nightly`) with amber-ink icons; stable appId `dev.chia1104.solyx` (user's choice).
- No paid Apple or Windows certificates yet (Linear CHI-29): mac ad-hoc signed, hardened runtime off; a future Developer ID needs disable-library-validation for user-downloaded broker SDKs.
- Updates (PR #19, 2026-10-08): installers + electron-updater feeds go to R2 behind `download.usesolyx.trade/<stable|nightly>/` (user registered the domain; `release` GitHub environment holds R2 secrets/vars). Windows auto-updates (unsigned for now); macOS only notifies and links to the GitHub release until a Developer ID exists. Windows signing plan: apply to SignPath Foundation once releases exist (Azure Artifact Signing excludes individuals outside US/Canada; Certum OSS is the fallback).

Windows CI packaging fixed by PR #18 (vite.config.ts tasks with cache:false); first nightly v0.0.1-nightly.20261007.3 published 2026-10-07. The R2 upload works: on 2026-11-11 `download.usesolyx.trade/nightly/nightly-mac.yml` and `nightly.yml` answered 200. Unverified: a Windows self-update and running the Windows build (Linear CHI-28), the ad-hoc dmg's Gatekeeper flow on another Mac, Fubon utility process from app.asar, the stable release workflow (never dispatched yet; Linear CHI-15). Related: [[solyx-commit-to-main]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-release-pipeline.md`, type `project`).
