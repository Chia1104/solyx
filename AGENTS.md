# Solyx

Personal desktop app for trading Taiwan and US stocks: an agent analyzes and proposes trades, and every order waits for the user to confirm it. Open source, local-first and bring-your-own-key, with no paid tier. It has one maintainer and no external consumers of internal APIs.

## Engineering principles

- Delete obsolete paths. Migrate both sides of an internal contract together; do not add compatibility layers, fallbacks or migration shims.
- Ship the smallest end-to-end change that works. Avoid speculative abstraction, configuration and indirection.
- Put extension seams at contracts, policies, ports and repositories, not unused flags or plugin systems.
- Use the current stack as designed. Check dependency docs and types before downgrading, replacing or routing around an API.
- Prefer existing dependencies over custom code or new packages.
- Choose the long-term design; do not land stopgaps intended for later replacement.
- Comments explain constraints and invariants, not implementation history. One sentence for what the symbol does; a second only when the code cannot show why. If the name is enough, write nothing. Do not restate identifiers, narrate migrations or decorate files with section banners. Keep `SAFETY`, `@deprecated`, `@default` and `@example`.
- `AGENTS.md` records boundaries and invariants. Update it when a seam changes, not when a feature ships. Do not add walkthroughs, procedure catalogs, UI placement or implementation history.

## Architecture

| Path                                              | Role                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` (`@solyx/core`)                   | Market rules (tick sizes, board and odd lots, trading sessions), candles and technical indicators, the `BrokerAdapter`, `MarketDataProvider` and `MarketDataStream` contracts, the `checkOrder` risk checks and the `OrderDesk` order flow                              |
| `packages/brokers` (`@solyx/brokers`)             | One module per broker. `./paper` is the paper broker and the only one the app wires today; `./fubon` loads the user's own Fubon SDK at runtime, signs in with an API key and exchanges the session for market data tokens; it does not implement accounts or orders yet |
| `packages/market-data` (`@solyx/market-data`)     | One module per market data provider; `./fugle` and `./fubon` cover Taiwan listings and `./candle-cache` keeps closed sessions through `@solyx/db`. Main process only; boundaries in [`packages/market-data/AGENTS.md`](packages/market-data/AGENTS.md)                  |
| `packages/db` (`@solyx/db`)                       | SQLite databases: drizzle-orm schemas, drizzle-kit migrations and repositories such as the candle store, the watchlist and the proposal store. Main process only; boundaries in [`packages/db/AGENTS.md`](packages/db/AGENTS.md)                                        |
| `packages/trading-chart` (`@solyx/trading-chart`) | Domain-free React bindings for Lightweight Charts v5; boundaries in [`packages/trading-chart/AGENTS.md`](packages/trading-chart/AGENTS.md)                                                                                                                              |
| `packages/utils` (`@solyx/utils`)                 | Cross-runtime, domain-neutral utilities; boundaries in [`packages/utils/AGENTS.md`](packages/utils/AGENTS.md)                                                                                                                                                           |
| `packages/i18n` (`@solyx/i18n`)                   | JSON translation catalogs per consumer, `en-US` as the source locale; boundaries in [`packages/i18n/AGENTS.md`](packages/i18n/AGENTS.md)                                                                                                                                |
| `apps/desktop` (`@solyx/desktop`)                 | Electron, split by process first and module second; layout under [Desktop layout](#desktop-layout)                                                                                                                                                                      |
| `tools/oxlint/anti-slop`                          | Vendored anti-slop Oxlint plugin; its source and local deviations are recorded in `UPSTREAM.md`                                                                                                                                                                         |

- Desktop main and preload are bundled with `vp pack`, which inlines `@solyx/*`; the renderer is built with `vp build`.
- The main process is the only backend and owns all I/O: broker SDKs, market-data HTTP through `ky`, LLM calls and secrets. The renderer makes no network requests and holds no keys. There is no local HTTP server; if an external client such as an MCP server ever needs one, add it as a thin host over the packages, bound to localhost, and never expose `confirm`.
- SQLite runs on the runtime's built-in `node:sqlite` through drizzle-orm, so the app ships no native modules. `@solyx/db` owns every schema, migration and repository; each database is its own file in `userData`, and `vp pack` copies its migrations beside the main bundle, where drizzle's migrator reads them at startup.
- Live bars come from a `MarketDataStream`. The main process's `live-candles` hub keeps each watched symbol's session of minute bars, folds them into the intervals windows watch and pushes whole bars, so the renderer only upserts them by time. Only today's session is pushed; closed sessions come from history through the candle cache.
- Market data providers enforce the limits of the plan the user holds; the main process keeps one provider per credential and plan so request budgets hold across requests. The config file picks each market's source, and charts and the live stream switch with it.
- Fubon market data needs a signed-in Fubon session, whose SDK calls block the main process until Fubon answers. The main process signs in once per saved settings on first use, and keeps a failed sign-in instead of retrying it until the settings change or the user asks, since repeated failures could lock the account. The SDK logs the ID number and account details to `./log` with no setting for it, so the main process works from a folder in `userData` once it signs in.
- Settings the main process reads live in `~/.<app-name>/config.jsonc` (`~/.solyx`, `~/.solyx-dev`, …), JSONC a person may edit. The main process watches it and applies saved edits without a restart, edits values in place so comments survive, reads an entry that no longer parses as its default, and never overwrites a file with syntax errors. Secrets and caches stay in `userData`. The theme is one of these settings: the main process applies it through `nativeTheme.themeSource`, which the renderer's `prefers-color-scheme` follows, so the renderer never picks a palette on its own.
- Technical indicators are pure functions in `@solyx/core/indicators`, one value per bar and `null` while warming up, so charts and future agents read the same numbers.
- Provider keys and other secrets are saved by the settings module as ciphertext in `userData`, encrypted with Electron's async `safeStorage`, whose key lives in the Keychain on macOS, under DPAPI on Windows and in libsecret or KWallet on Linux. The main process decrypts a key only when a provider needs it; the renderer can save or delete a key but never read one back. Where the OS has no secret store (Linux `basic_text`), nothing is saved.
- The app's name selects its `userData`, config folder and OS secret store entry. Unpackaged runs rename it to `<productName> Dev`, so development never touches an installed build's data or credentials; packaged channels, such as a future nightly, are separated by the product name they are built with.
- The renderer uses TanStack Router with hash history (builds load from `file://`), TanStack Query for everything read from the main process, and zustand for client-only state. HeroUI v3 on Tailwind CSS v4 is used directly; compose `react-aria-components` where HeroUI has no equivalent and add no other primitive library.
- The workspace is drawn in pencil and ink: hatching and dashed rules mark what is not real yet (paper trading, proposals awaiting confirmation), the accent marks what is, and confirming a proposal is the only accent-filled button. Red and green belong to price direction alone, which Taiwan quotes the opposite way from the US.
- First-run setup is the `/onboarding` route, which takes the whole window until it is finished or skipped, and never shows once market data already works. Each `OnboardingStep` reuses its feature's settings components, so setup a new feature needs, such as an LLM key or a live broker, becomes another step rather than a separate flow.
- The production CSP forbids eval and remote sources, so zod runs `jitless` in the renderer and inline `<style>` is the only relaxation.

## Desktop layout

`apps/desktop/src` splits by process first, so each tsconfig keeps Node and DOM apart, then by module (`account`, `market`, `proposals`, `settings`, …). A module keeps one name across every process.

| Path                                           | Holds                                                                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/ipc/<module>.ts`                       | The module's IPC contract: an `XxxApi` interface and `xxxChannels`, plus `XxxEvents` and `xxxEvents` for pushes from main. `solyx-api.ts` composes them into `window.solyx`; imported as `#shared/*`        |
| `main/modules/<module>/`                       | IPC handlers and main-side logic. Handlers bind through `ipcModule<XxxApi>(channels, schemas)`, which parses every argument with zod because renderer input is untrusted                                    |
| `main/ipc/`, `main/shell/`, `main/services.ts` | IPC infrastructure and registration; windows and future menus or updaters; the composition root                                                                                                             |
| `preload/index.ts`                             | The contextBridge that maps each module's channels onto `window.solyx.<module>`                                                                                                                             |
| `renderer/modules/<module>/`                   | The module's TanStack Query options (`xxxQueryKeys`, `xxxQuery()`), components, form schemas and hooks                                                                                                      |
| `renderer/pages/`                              | Route components that only compose modules                                                                                                                                                                  |
| `renderer/components/`                         | Module-neutral components composed from HeroUI: the error boundary fallback, the loading and error states every module renders, and the pane splitter, sheet, sections and symbol rows the workspace shares |
| `renderer/app/`                                | Router, root layout (the title bar and the resizable side panes around the routed main view), i18n, query client, theme and zod setup                                                                       |

- Adding or changing a channel touches its contract, handler, preload bridge and renderer call site together.
- Main pushes with `webContents.send` on an event channel. The preload exposes each as `onXxx(listener)`, which returns a function that stops listening, and never exposes `ipcRenderer` itself; a handler that needs the asking window takes the invoke event as its last argument.
- Modules may use another module's query keys to invalidate what they change (a confirmed order refreshes `account`); anything shared more widely moves to a package.
- Routes fall back to `ErrorFallback` through the router's `defaultErrorComponent`. A widget that can fail on its own, such as the chart, sits in TanStack Router's `CatchBoundary` so the rest of its page stays usable.

## Trading invariants

1. **One road to an order:** `OrderDesk.propose` → `checkOrder` → the user confirms in the UI → `OrderDesk.confirm` → `broker.placeOrder`. Agent tools may only call `propose`; `confirm` is reachable only from a user action in the renderer. Nothing else calls `broker.placeOrder`.
2. **Failed submissions are never retried:** `failed` is terminal. The broker may have accepted the order anyway, so a retry could duplicate it. A proposal still submitting when the app exits fails the next time the `OrderDesk` opens, for the same reason.
3. **Broker SDKs stay out of the repository and the installer:** users download SDKs such as `fubon-neo` themselves, and the app loads them at runtime from a path the user chooses.
4. **Secrets never persist in plain text:** certificates (`.pfx`), passwords and API keys never reach the repository, logs or error reports.
5. **No relay server:** market data and LLMs use the user's own keys, and data flows straight from the provider to the user's machine.
6. **Paper by default:** a live broker is wired into the `OrderDesk` in `services.ts` only after the user explicitly turns it on.

## Repository rules

- Write documentation and comments in English. UI copy lives in `@solyx/i18n` and reaches the renderer through `react-i18next`; components never hard-code user-facing strings.
- Forms use react-hook-form with `zodResolver`; each HeroUI field is wrapped in a `Controller`, and validation messages come from the catalog.
- Put dependency versions in the appropriate catalog in `pnpm-workspace.yaml`; package manifests reference catalog keys. Internal dependencies use `workspace:*`.
- `@solyx/*` packages export source and need no build step. Each `exports` key mirrors one module under `src/`; do not add a root export or sibling-only barrel.
- Take general-purpose helpers (debounce, memoize, retry, groupBy, …) from `es-toolkit`, imported from its root; `@solyx/utils` holds only what es-toolkit lacks.
- Import a symbol at the call site. Do not rename or re-export it through a local wrapper; wrap only when adding behavior.
- An enum is a PascalCase const object with PascalCase keys plus a same-named type, `export type Foo = (typeof Foo)[keyof typeof Foo]`; no TS `enum`, bare string-literal unions or `as const` arrays. Schemas derive from it (`z.enum(Foo)`) and untyped input narrows with `isEnumValue` from `@solyx/utils/is`.
- zod is imported as `import * as z from "zod"`. Schemas are camelCase with a `Schema` suffix, sit beside the const object or type they validate, and types derive from them with `z.infer`.
- A type assertion needs a `SAFETY:` comment; prefer narrowing, `satisfies` or a parser at the boundary so the assertion is not needed.
- Use the Oxlint, Oxfmt and Vitest that ship with Vite+. Lint, format and staged rules live in the root `vite.config.ts` because Vite+ ignores nested configs; the pre-commit hook in `.vite-hooks/pre-commit` runs `vp staged`.
- `vp run` executes tasks in a clean environment, so most variables set outside it do not reach the task.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
