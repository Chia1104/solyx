---
type: fact
title: "apps/website deploys through Void on Cloudflare Workers (PR #164, merged 2026-10-17); what was decided, what is still unverified"
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

# apps/website deploys through Void on Cloudflare Workers (PR #164, merged 2026-10-17); what was decided, what is still unverified

On 2026-10-17 the website was put on Void (voidzero's `void` 1.1.11) in framework mode, as the user asked, by linking Void's TanStack Start guide. The work went onto the user's PR #164 (`feat/website`), which was squash-merged into develop on 2026-10-17 as e3426ba.

- `voidPlugin()` sits before `tanstackStart()`. Every page is still prerendered, and the Worker only answers requests that match no file.
- `void.config.ts` sets `assets.html_handling: "drop-trailing-slash"`. Cloudflare's default redirects `/docs/x` to `/docs/x/`, which fights TanStack Router's URLs.
- `voidPlugin` is skipped under `process.env.VITEST`. Otherwise Vitest fails with "depsOptimizer is required in dev mode".
- The SSR `optimizeDeps` setting includes `fumadocs-mdx/runtime/macro`. Without it, the first dev request reloads the server mid-render and React reports "Invalid hook call".
- `build` and `deploy` are vite.config tasks, not package.json scripts. `deploy` is `cache: false`, because a script would get cached under root `run.cache: true`. `build` excludes `.void/**` (Miniflare's state) and `.wrangler/**` from cache inputs.
- `allowBuilds` has `workerd: false` (it only verifies its binary) and `better-sqlite3: false` (Void uses it only for a local DB).
- `void deploy` detects vite-plus and runs `vp build`. There is no `vite` bin in this repo.
- Root scripts are now `dev:desktop`, `build:desktop`, `dev:website`, `build:website` and `deploy:website`. `dev` was removed.

**Why:** the user wants Void as the website's host. The static-only boundary in the website's AGENTS.md was kept as "every page is prerendered".

**State as of 2026-10-18:**

- #208 was merged by the user as a9dcb1b; the classifier denied my `gh pr merge`.
- The Website workflow's first CI deploy succeeded (run 39050007949). Docs navigation was verified live in a browser, with no errors.
- The worktree and local branch were removed. The remote branch `ci/website-deploy` was left (gone by 2026-11-11: `git ls-remote` no longer lists it).
- Open, the user's call:
  - Cloudflare injects a Web Analytics beacon (static.cloudflareinsights.com, `/cdn-cgi/rum`) into browser requests. This breaks the website AGENTS rule "no analytics" and is a zone setting, not repo code. (Linear CHI-18)
  - Apex TLS was slow from the user's machine: about 0.6–1.4 s against about 0.1 s for download.usesolyx.trade on the same IPs. The apex serves the universal cert issued 2026-10-17 15:14 UTC; the cause is unknown, and the user was told to recheck later. On 2026-11-11 it no longer reproduced from this machine (TLS 0.07 s, total 0.40 s).

**Social cards (PR #209, `feat/website-og-images`, worktree `../solyx-website-og`, opened 2026-10-18, merged).**

- The user picked Fumadocs' Takumi recipe (`generateOGImage` from `fumadocs-ui/og/takumi`). Its TanStack Start variant needs Nitro's prerender, because TanStack's prerender writes `res.text()` and corrupts images.
- So a client-env Vite plugin (`socialCards` in vite.config.ts) draws the cards in Node with `takumi-js/node` (native). It uses Archivo plus all 108 Noto Sans TC fontsource slices registered under one name, which renders CJK fine. It emits `og/<path>/image.png`.
- Wiring: `og:image` comes from `src/lib/social-card.ts` on `SITE_URL` in `links.ts`, and the root sets `twitter:card`.
- Measured runtime cost on Workers Free, the reason it was not done at runtime: WASM takes 4–9 ms warm, about 60 ms CPU on a cold first render, and about 170 ms to register a CJK font. The 10 ms cap would mean 1102 errors.
- A Worker size limit is no longer the issue: since 2026-09 there is only the 64 MiB uncompressed limit.

**Docs layout (PR #210, `feat/website-docs-layout`, worktree `../solyx-website-layout`, 2026-10-18, merged).**

- The user compared docs/Spacious/Glass/Notebook screenshots and chose Spacious, which is Base UI only. It needs the `fumadocs-ui/css/generated/spacious.css` import.
- Verified: the panel scrolls, not the window. Page changes reset to the top, the TOC works, and mobile is fine.
- #209 (social cards) was merged by the user.
- At the user's request, the Fumadocs bump to 16.17.5 (core and base-ui) was added to #210 as commit a54e0a5. Search was verified in en and zh-TW.

**Download page and changelog (stack #211 → #212, worktrees `../solyx-website-download` and `../solyx-website-changelog`, 2026-10-18, both merged).**

- Data: GitHub releases are read once per build in Node through `readReleases(GITHUB_TOKEN)` in `src/lib/releases.ts` (zod, drafts skipped). They are exposed as the virtual modules `virtual:latest-releases` and `virtual:release-notes`, typed in `src/virtual-modules.d.ts` via `#lib/releases`, because relative imports are banned in ambient modules.
- Installers link to GitHub release assets, because R2 keeps only the newest nightly.
- Freshness: `website.yml` gained `workflow_call`, and nightly.yml and release.yml call it after publish. Job-level concurrency was used. A scheduled trigger was avoided because Nightly polls every 30 min.
- Token: CI build and deploy pass `GITHUB_TOKEN`. Vite+ passes `*_TOKEN` to cached tasks, and Void doesn't scrub it.
- Platform detection uses `useSyncExternalStore` with an undefined server snapshot (no hydration mismatch). Logos come from lobe-icons apple/microsoft, because simple-icons dropped Windows.
- The changelog parses `* <title> by @x in …/pull/N` and groups by Conventional Commits type (feat/fix/other) with a scope badge. The nav gained Changelog, the footer's Releases link became Changelog, and `nav.releases` was removed.
- On request, the download page got Stable and Nightly tabs (commit 68be7de on #211). The default is the lead channel (Nightly until a stable release exists). Stable shows a pencilled "Coming soon" with a button over to Nightly. This was merged up into #212 (8bb84a1, conflict in installers.tsx resolved).
- The mac build is arm64 only, because electron-builder has no arch set and the runner is Apple silicon.

**How to apply:** live since 2026-10-18. The user's first local deploy succeeded: Worker `solyx-website`, version bd08fec6, on https://usesolyx.trade. www has no record. `void.lock.json` was committed to #208 as 75549a7; it holds only routes, assets, account_id and name. The user set `CLOUDFLARE_API_TOKEN` in GitHub environment `website`, which has no protection rules. Workers observability is on by Void's default; that was not discussed with the user.

**CI deploy (PR #208, `ci/website-deploy`, opened 2026-10-17).** The user asked for an auto-deploy action on `usesolyx.trade`, from develop.

- `.github/workflows/website.yml` triggers on a push to develop, filtered by path to the website, core, i18n, trading-chart, utils, the lockfile and the workspace file. It runs `vp run @solyx/website#deploy` in environment `website` with `CLOUDFLARE_API_TOKEN`.
- It does not wait for CI. Its concurrency group is never cancelled, because a cancelled staged deploy blocks the next one.
- The deploy task is `void deploy --platform cloudflare`. Without the flag, a fresh checkout, which has no `.void/project.json`, falls back to Void's hosted platform.
- `void.config.ts` has the `routes` custom_domain `usesolyx.trade`. Routes turn workers.dev and preview URLs off, so Void stages the version at 0% and probes `usesolyx.trade/__void/ready`. No `CLOUDFLARE_WORKERS_SUBDOMAIN` is needed (checked in `@void/deploy-cloudflare`).
- The Worker name derives from the package: `solyx-website`. `void domain add` with void.config.ts edits `.void-wrangler.jsonc` and the lock, not void.config.ts.
- Planned order: the user does the first deploy locally, commits `void.lock.json` (which pins the account), then merges. The token needs Workers Scripts: Edit plus Zone Workers Routes: Edit on usesolyx.trade.
- Unverified until it runs: the CI deploy itself. (It ran: the first CI deploy succeeded on 2026-10-18, see the state above.)
- Void 1.1.11 bug, found on the user's first local deploy (2026-10-17). Three things stash the pointer in `.void/preview-deploy-config.json`: every ordinary build; `migrateLegacyVoidConfig` at the start of every deploy, if a pointer exists; and the `finally` of every deploy. The next deploy build's prerender preview restores that stash and registers an on-exit delete of `.wrangler/deploy/config.json`, so `void deploy` fails with ENOENT on that file.
  - The fix is to delete both the stash and `.wrangler/deploy` before each local deploy. This was proven by simulating it with Void's own migrate function. A fresh CI checkout has neither.
  - My mistake: the leftover pointer from my test builds caused two of the user's failures, so clean up after test builds.
  - No workaround was landed in the repo; reporting it upstream was offered to the user (Linear CHI-45).
- The second blocker: "built Worker contains an unsupported module assets/meta-color-….svg".
  - Cause: TanStack Start's `builder.buildApp` replaces the Cloudflare plugin's `createBuildApp`, which moves server-emitted assets to the client. Void's copyBundle rejects any non-module file in `dist/server`.
  - Fix (commit 2efdc7e on #208): an inline plugin's `configEnvironment` sets ssr `build.emitAssets: false`. A user `environments.ssr.build.emitAssets` alone loses to the Cloudflare plugin.
  - Verified with a deploy-style build and with preview.
- The third blocker, found live after the first deploy (2026-10-18): client-side docs navigation hit a 404 on `/__tsr/staticServerFnCache/*.json`, giving "Unexpected token '<'".
  - Cause: `staticFunctionMiddleware` writes its cache with node:fs and needs `TSS_CLIENT_OUTPUT_DIR`. The Cloudflare plugin's prerender runs on workerd, so nothing was written. This was broken since #164, whose checks only curled HTML.
  - Fix (0e947c9 on #208): the docs loader reads `source` client-side, since it was already in the client bundle, and the layout takes `source.getPageTree(locale)`. The package was removed.
  - Verified in a browser over preview on 12 pages: no fetches and no console errors.
  - Lesson: verify client-side navigation in a browser, not just curl.
- 2026-10-17 DNS: usesolyx.trade is on Cloudflare NS; the apex and www have no records.

Workers Free fits this site: the Worker is about 1.06 MiB uncompressed against a 64 MiB limit, there are 55 static files against a 20,000 limit, and requests for static assets are free and unlimited. Only requests that match no file count toward the 100k/day limit and the 10 ms CPU limit. Whether the SSR 404 page stays under 10 ms has not been measured (Linear CHI-45). A custom domain is added with `void domain add <host>`. It needs the zone to be active in the same Cloudflare account, and the hostname must not already have a CNAME. The command writes a route into `void.config.ts`, which then needs committing.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-website-void.md`, type `project`).
