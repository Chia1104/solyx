---
type: fact
title: "2026-10-17 apps/website redesign after Cloudflare (stack #204 → #205), shadcn tokens on Base UI, ink blue kept; i18n en-US + zh-TW stacked as #207"
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

# 2026-10-17 apps/website redesign after Cloudflare (stack #204 → #205), shadcn tokens on Base UI, ink blue kept; i18n en-US + zh-TW stacked as #207

On 2026-10-17 the user asked to redesign `apps/website` after cloudflare.com, move it onto shadcn (Base UI styles, `base-<style>` in components.json) and organize the theme on shadcn tokens. Built the same day as stacked PRs #204 (`refactor/website-shadcn`: tokens, shadcn.css, Button/Tabs/Badge via the CLI, ToggleGroup watchlist, plans 001–004) → #205 (`feat/website-redesign`: hero horizon, Sheet rails, plans 005–006); both open, #205 must be retargeted to develop after #204 merges.

Decided by the user:

- Keep the ink blue (`#2b45d4` / dark `#8097ff`) as the accent, not Cloudflare's orange. My reason, which they accepted: in Taiwan red means a rising price, so an orange-red brand next to candles reads as "up".
- The layout direction is approved: an inset rounded hero panel whose bottom edge is the horizon, with the ink sun and a halftone halo above it and the pencil half below. Dashed rails with square handles frame the page. Cells share hairlines, and exactly one cell is filled with ink. Pills are for site chrome; the demo window keeps the app's 6px radius. There is no ink panel at the close.
- They asked for more motion. On 2026-10-17 /improve-animations produced six plans in `plans/` at the repo root (untracked): 001 tokens, 002 ink wipe on the signed proposal, 003 agent message entrances, 004 shadcn Button press, 005 hero sunrise sequence, 006 headline inking. The user took my recommendation and dropped the order road's ink-line draw. 001–003 run on current code, 004 after the theme refactor, 005–006 inside the redesign PR.

Facts found: `fumadocs-ui` is already `@fumadocs/base-ui`. Fumadocs ships `css/shadcn.css`, which maps `--color-fd-*` onto shadcn variables. The desktop app uses HeroUI, so the website is the only shadcn consumer.

**Why:** the user wants the site to read like Cloudflare's while staying Solyx's drafting sheet (pencil = drafted, ink = signed).

**How to apply:** two stacked PRs, as built. The first is `refactor(website)`: shadcn tokens, `shadcn.css`, class renames and shadcn Base UI components. The second is `feat(website)`: the redesign plus the motion. Motion tokens are `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` and `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Every reveal travels left to right.

Lessons from building it: `shaders`' Halftone ignores a transparent paper colour and draws grey, so the halo is a `DotGrid` whose `dotSize` maps the alpha of a hidden `RadialGradient`. A clip-path keyframe needs an explicit `to`, because `inset()` cannot interpolate to `none`. shadcn's Button forces `size-4` on any svg without a `size-` class, which is why the watchlist is a Base UI `ToggleGroup`. React reuses the empty state's `<p>` for the first message, so the conversation is keyed by the question.

On 2026-10-17 the user asked for loops, which went into #205.

- The drafts first redrafted one slip at a time. The user then sent a recording of Cloudflare's "Fighting infra" cell and asked for its marquee. The drafts now drift right in four rows into the ink cell, which is CSS `animate-drift` over two copies of each row.
- The ink cell has halftone ripples: a `DotGrid` whose dot size maps from a hidden `Ripples` layer.
- The road fills step by step. It lost its dots and numbers, at the user's request.

They also asked to soften the hero's "shadow". I read that as the black border on the panel's lower edge curling up its corners, and replaced it with a pencil rule that fades out at the ends; the user has not confirmed that reading. I kept the road's ink steps as a wash, not solid, so the legend's cell stays the only solid ink. I proposed that rather than asked.

A marquee row (`w-max`) inside a single-column grid made the mobile page overflow. The fix is `grid-cols-1` (`minmax(0,1fr)`), not `overflow-hidden` on the row's container.

On 2026-10-17 the user asked for i18n ("多個功能 i18n 的部分") without specifics, and I picked the defaults. These are my picks, not theirs:

- The locales are the app's, `en-US` and `zh-TW`. English stays at the root paths and zh-TW lives under `/zh-TW`, through TanStack's optional `{-$lang}` plus Fumadocs `hideLocale: "default-locale"`. This is because a static prerender cannot redirect `/docs` to `/en/docs`.
- The landing page, the demo and every docs page are translated. The copy lives in `@solyx/i18n/website/*.json`, and the demo reuses the `desktop/` catalogs.
- It went up as PR #207 (`feat/website-i18n`), stacked on #205. The merge order is #204 → #205 → #207.
- I skipped hreflang, since the site has no production origin yet.

Lesson: `perl -pi` without `-CSD -Mutf8` treats a `[。，]` class as bytes and splits CJK characters. In zh-TW MDX, put the punctuation outside the bold (`**數量**。`). CommonMark will not close `**` after `。` when a CJK letter follows it.

On 2026-10-18 the user asked for landing polish plus new not-found and error pages modelled on chia1104.dev's `StatusSheet` (isometric block letters). Opened as PR #214 (`feat/website-landing-polish`, two commits), not merged yet. These were my picks, not the user's:

- The hero copy and the demo's heading overlap the sun over a radial `scrim`. A dense one read as an eclipse, so it fades out from the centre.
- The order road's highlight is a single sheen plus ink-coloured titles on the inked steps.
- The footer nav is now muted, like Fumadocs' header.
- The changelog version heading uses Fumadocs' `Heading`, which adds a copy-link button.
- `useLocale` reads the path, which fixes English 404s under `/zh-TW`.

Lesson: `clip-path` hides an element but still counts toward scroll overflow, so a translated sheen widened the mobile page. Add `overflow-hidden` to its container.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-website-redesign.md`, type `project`).
