---
type: fact
title: "2026-10-21 website docs split into setup/, orders/, agent/, research/, data/ + files, both locales; screenshots from repo or R2 assets.usesolyx.trade/docs with locale/scheme tags and browser fallback; PR #275; 2026-10-22 116 app shots uploaded; 2026-10-25 PR #320 adds backtests + browsers pages and 24 shots"
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

# 2026-10-21 website docs split into setup/, orders/, agent/, research/, data/ + files, both locales; screenshots from repo or R2 assets.usesolyx.trade/docs with locale/scheme tags and browser fallback; PR #275; 2026-10-22 116 app shots uploaded; 2026-10-25 PR #320 adds backtests + browsers pages and 24 shots

On 2026-10-21 the user asked to expand and split the website docs, use more Fumadocs components, add vendor links and image placeholders for third-party setup, and document how Solyx computes its data. Opened as PR #275 from `docs/website-guides` on 2026-10-21, merged since. 38 pages per locale; `data/` pages state formulas from `@solyx/core`; zh-TW was translated by four agents with English heading ids (`[#id]`).

**Why:** 42 base names render as pencilled placeholders via `<Screenshot>` until a file exists. The user chose to host them on R2 bucket `solyx-assets` at `assets.usesolyx.trade` (key `docs/<path>`), with variants `name[.zh-TW][.light|.dark].png`; both locales use the same base name.

**How to apply:**

- The build HEAD-checks the host once, so new uploads show from the next deploy.
  - On 2026-10-22 CI failed on a transient R2 500, and the user asked for fallbacks instead.
  - Now an unanswered check is offered anyway (the build warns, never fails), and the browser falls through the candidates, then to the pencil frame (commit 84546c0a).
- On 2026-10-22 the user asked me to capture the app's shots and upload them.
  - I captured all 29 app screens in en and zh-TW, light and dark: 116 files.
  - Method: a throwaway "Solyx Docs" identity with synthetic data. The harness was a wrapper `main.mjs` that faked Fugle and the model in `globalThis.fetch`, a seed script through the db and core modules, and a stand-in Fubon `trade.js`. The identity is deleted.
  - The 13 vendor and OS shots (`setup/*`, `install/*`) are left to the user.
  - Uploaded 2026-10-22 with the user's `wrangler login`: `wrangler r2 object put solyx-assets/docs/... --remote`, cache-control 1 h. All 116 were verified byte-identical on the asset host.
  - Uploading through the Cloudflare MCP is not practical, since its code runs remotely and file bytes would have to be inlined. A temporary upload Worker was refused by the auto-mode classifier.
  - The asset domain's edge caches a GET 404 for 4 hours, while HEAD is not cached. So never GET a key before it is uploaded, or purge the URL after uploading.
- #275, #320, #325 and #343 are all merged, so nothing waits on those branches; later docs work goes on a branch of its own ([[solyx-commit-to-main]]).
- 2026-10-25, PR #320 (`docs/website-backtests-devices`): the user asked to document features added since #275 with shots split by locale and scheme.
  - New pages `backtests` (the panel) and `browsers` (paired browsers, passkeys); `data/backtests` rewritten (Sharpe, p-value, plateau, walk forward, limits); agent (parked runs), orders, mandate (#282 day count), workspace, files (`remote`), rotation and the privacy policy (paired browsers) updated.
  - 24 shots uploaded and verified: `backtests/{run,scan,walk-forward,history}` and `settings/devices` in 4 variants, `devices/{pairing,passkey}` per locale with no scheme, since the pairing page is always light.
  - Harness kept at `/tmp/solyx-docs2` (see [[solyx-isolated-smoke-run]]); the identity is deleted. Other shots made before (e.g. `workspace/symbol-page`) still predate the Backtest tab (Linear CHI-20).
  - Seen, not fixed, and listed in the PR: Mark on chart stretched the price scale to ~4,000 for a channel breakout run; the pairing page ignores theme and palette; `remote.enabled`'s schema description still says browsers cannot confirm (Linear CHI-76; still so on 2026-11-11, in `packages/backend/src/modules/settings/config-file.ts`).

Related: [[solyx-website-void]], [[solyx-website-redesign]], [[solyx-legal-pages]], [[solyx-isolated-smoke-run]].

- 2026-10-25, PR #325: rolling windows sections, and `backtests/rolling` uploaded in 4 variants with `pnpm dlx wrangler r2 object put … --remote --content-type image/png --cache-control "public, max-age=3600"`. The capture helper is `/tmp/solyx-docs2/rolling.sh`.
- 2026-10-27, pushed to PR #343: all settings shots were retaken for the grouped sidebar, 16 pages × 4 variants = 64 files, uploaded and checked byte for byte.
  - They sit under new keys `docs/settings/<group>/<section>`, since overwriting a live key would change develop's site before the PR merged. #343 is merged, so the old flat `docs/settings/*.png` keys can be deleted now; whether they were is unchecked.
  - New kit pieces in `/tmp/solyx-docs2`:
    - `settings.sh`: `capture_settings <variant>`, `mcp_shot`, `real_paths` (rewrites `~/.solyx-docs-dev` to `~/.solyx` in the DOM); it captures twice because the first capture misses a modal's backdrop.
    - `secret.sh`: `save_secret <row label> <value>` through the row's own button.
    - `fubon-sdk/package`: a stand-in `trade.js` plus `package.json` 2.4.0, and `certificate.pfx`.
    - `patch.mjs` answers Ollama's `/v1/models`.
  - Where state comes from:
    - Backup: `backup.json` is seeded (location, `checkedAt` = now, uploadedAt, stored count/bytes). The worker thread's fetch is not patched, so saving the passphrase before seeding makes an automatic backup fail; a restart clears it.
    - MCP: the stand-in stdio server was at `/Users/Shared/research-notes-mcp/server.mjs` (deleted).
    - Device: paired through `abp` with `authenticator.mjs`.
    - Non-secret settings: written to `config.json`, keys taken from `config.schema.json`.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-website-docs-guides.md`, type `project`).
