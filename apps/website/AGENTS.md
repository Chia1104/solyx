# `@solyx/website`

The project's website: the landing page and the docs, on TanStack Start and Fumadocs, prerendered and deployed to Cloudflare Workers through Void.

## Boundaries

- Every page is prerendered: `vp build` writes each one into `dist/client`, so a route that needs a server per request does not belong here. A docs page reads its data through a server function under `staticFunctionMiddleware`, whose results the build writes to files, and search downloads the index `/api/search` exports and runs in the browser.
- Void deploys the site: `voidPlugin()` builds it for the Workers runtime, Cloudflare serves the prerendered files, and the Worker answers only what no file matches. The Worker's settings live in `void.config.ts`; `void.lock.json`, once a deploy writes it, is committed beside it.
- The crawler only follows links, so `vite.config.ts` lists every docs page for the prerender itself.
- Docs are MDX in `content/docs`, ordered by its `meta.json`. They describe what the app does today, taken from its code and the root README, and change with the code they describe.
- The site sends nothing about its visitors: no analytics, fonts self-hosted through Fontsource, and the Shaders canvas runs with `disableTelemetry`.
- The site is English only, so its copy lives in its routes and MDX. The demo workspace is the exception: it shows the app, so its labels come from the desktop's English catalog in `@solyx/i18n`.

## Theme and components

- `src/styles/app.css` sets the app's Blueprint palette as shadcn's tokens (`--background`, `--primary`, `--muted-foreground`, …). Fumadocs reads them through its `shadcn.css` preset, so the docs and the landing page share one theme. Tokens shadcn has no name for (`--graphite`, `--hatch`, `--rise`, `--fall`, the candles, the ink's gradient ends) sit beside them.
- Interactive pieces are shadcn's Base UI components in `src/components/ui`, added with the shadcn CLI (`components.json`, style `base-vega`) and edited in place. Where no shadcn component fits, use the Base UI primitive directly, as the watchlist does with `ToggleGroup`. A link styled as a button stays a link and takes `buttonVariants`.
- Motion uses the theme's `ease-out` and `ease-in-out`, which `app.css` redefines as strong curves. Reveals travel left to right, the way a pen moves. Under reduced motion, only fades remain.

## Landing page

- It is drawn on the app's drafting sheet: hatching and dashed outlines are pencil, what the agent drafted, and the primary colour is ink, what the user signed.
- The hero draws the app icon's emblem on a WebGPU canvas from `shaders`, loaded after the page since the engine carries every effect it offers, and as SVG where WebGPU is missing. Canvases take the sheet's colours from the stylesheet through `useSheetColors`, so a theme change repaints them.
- The demo workspace runs on made-up prices from a fixed seed, so the server and the browser draw the same bars, and it fetches nothing. It reuses the app's own pieces where they are domain-free or pure: `@solyx/trading-chart` for the chart and `@solyx/core` for ticks, lots and indicators. Every price it shows sits on its listing's tick, and a proposal stays inside the next session's limits, as the app's risk checks would demand.
- Confirming a proposal is the only button filled with ink, as in the app, so it is the only `Button` on the default variant.
