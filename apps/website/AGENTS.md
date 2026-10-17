# `@solyx/website`

The project's website: the landing page and the docs, on TanStack Start and Fumadocs, prerendered and deployed to Cloudflare Workers through Void.

## Boundaries

- Every page is prerendered: `vp build` writes each one into `dist/client`, so a route that needs a server per request does not belong here. A loader reads what it needs where it runs, in the browser on client-side navigation, never through a server function: the Worker answers no navigation, and the prerender runs on workerd, where `staticFunctionMiddleware` cannot write its results to files. Search downloads the index `/api/search` exports and runs in the browser.
- Void deploys the site: `voidPlugin()` builds it for the Workers runtime, Cloudflare serves the prerendered files, and the Worker answers only what no file matches. The Worker's settings, including its one domain `usesolyx.trade`, live in `void.config.ts`; `void.lock.json`, which pins the account and the Worker, is committed beside it.
- The site follows `develop`, not the latest release: every push to `develop` that changes what the site is built from deploys it (`.github/workflows/website.yml`). A page about a feature goes live when it merges, so it lands with that feature's code.
- The crawler only follows links, so `vite.config.ts` lists every docs page for the prerender itself.
- Every page has a social card, drawn by the client build in Node with Fumadocs' Takumi template from the same page list, into `dist/client/og`; its `og:image` comes from `src/lib/social-card.ts`. Neither the Worker nor a prerendered route draws one: TanStack Start's prerender writes a response as text, which breaks an image, and drawing one would run past Workers Free's CPU time.
- Docs are MDX in `content/docs`, ordered by its `meta.json`. They describe what the app does today, taken from its code and the root README, and change with the code they describe.
- The site sends nothing about its visitors: no analytics, fonts self-hosted through Fontsource, and the Shaders canvas runs with `disableTelemetry`.
- The site speaks the app's locales, `en-US` and `zh-TW` (`src/lib/i18n.ts`). English keeps the site's own paths, and every other locale is the first segment of the path (`/zh-TW/docs/...`), through TanStack Router's optional `{-$lang}` segment and Fumadocs' `hideLocale: "default-locale"`. Each locale is prerendered on its own, so every page in every locale is listed in `vite.config.ts`.
- Copy lives in `@solyx/i18n`'s `website/` catalogs and reaches components through `react-i18next`, with one i18next instance per locale, so pages prerendered side by side never share a language. The demo workspace shows the app, so its labels come from the app's own `desktop/` catalogs. Its script returns data, not sentences, and the agent pane words it.
- A docs page in another locale is `name.<locale>.mdx` beside the English one, with its links written to its own locale's paths. Search finds only pages in the language on screen.

## Theme and components

- `src/styles/app.css` sets the app's Blueprint palette as shadcn's tokens (`--background`, `--primary`, `--muted-foreground`, …). Fumadocs reads them through its `shadcn.css` preset, so the docs and the landing page share one theme. Tokens shadcn has no name for (`--graphite`, `--hatch`, `--stipple`, `--rise`, `--fall`, the candles, the ink's gradient ends) sit beside them.
- Interactive pieces are shadcn's Base UI components in `src/components/ui`, added with the shadcn CLI (`components.json`, style `base-vega`) and edited in place. Where no shadcn component fits, use the Base UI primitive directly, as the watchlist does with `ToggleGroup`. A link styled as a button stays a link and takes `buttonVariants`.
- Motion uses the theme's `ease-out` and `ease-in-out`, which `app.css` redefines as strong curves. Reveals travel left to right, the way a pen moves. Under reduced motion, only fades remain. A loop runs only while its section is on screen (`useInView`). Under reduced motion, and before scripts run, it shows its finished state.

## Landing page

- It is drawn on the app's drafting sheet: hatching, stippling and dashed outlines are pencil, what the agent drafted, and the primary colour is ink, what the user signed.
- Below the hero, the page sits between the sheet's dashed rails (`Sheet`). Each band is ruled off by a `SheetRow`, with a registration mark where the rule meets a rail. Cells share hairlines instead of floating as cards, and only one is filled with ink. The site's own buttons are pills; the demo keeps the app's corners, since it shows the app.
- The hero panel's lower edge is the horizon. The sun is inked above it, with a halftone halo that grows as it rises, and pencilled below it. The pointer works as a pen, inking the dots it passes over. `--sun` on the page sizes both halves and the room left for them. The inked half is drawn on a WebGPU canvas from `shaders`, which loads after the page since the engine carries every effect it offers. Where WebGPU is missing, an SVG draws it at rest. Canvases take the sheet's colours from the stylesheet through `useSheetColors`, so a theme change repaints them.
- The demo workspace runs on made-up prices from a fixed seed, so the server and the browser draw the same bars, and it fetches nothing. It reuses the app's own pieces where they are domain-free or pure: `@solyx/trading-chart` for the chart and `@solyx/core` for ticks, lots and indicators. Every price it shows sits on its listing's tick, and a proposal stays inside the next session's limits, as the app's risk checks would demand.
- The model providers the sources section lists, in `model-providers.tsx`, are the agent's catalog as the app offers it: pi-ai's built-in providers less those `@solyx/agent`'s `models.ts` withholds, one per company, plus Ollama. They change with that catalog. The logos are lobe-icons', as the app's own settings use.
- Confirming a proposal is the only button filled with ink, as in the app, so it is the only `Button` on the default variant.
