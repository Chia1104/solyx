# Solyx

Personal desktop app for trading Taiwan and US stocks: an agent analyzes and proposes trades, and every order waits for the user to confirm it. Open source, local-first and bring-your-own-key, with no paid tier. It has one maintainer and no external consumers of internal APIs.

## Engineering principles

- Do not preserve backward compatibility. Migrate both sides of an internal contract together and remove obsolete paths; add no compatibility layers, fallbacks or migrations.
- Build the simplest thing that meets the current requirements, end to end, and add each capability on top of a product that already works. Avoid speculative abstractions, configuration and indirection.
- Use the project's dependencies before writing your own code or adding a package; check a library's docs and types before assuming it lacks a capability.
- Decide architecture for the long term; do not land a stopgap meant to be replaced.
- Comments explain constraints and invariants, not implementation history. One sentence for what the symbol does; a second only when the code cannot show why. If the name is enough, write nothing. Do not restate identifiers, narrate migrations or decorate files with section banners. Keep `SAFETY`, `@deprecated`, `@default` and `@example`.
- Each `AGENTS.md` records the boundaries and invariants of the code beneath it; put a rule in the nearest one that covers all the code it governs. Update it when a seam changes, not when a feature ships, and write only current rules: no walkthroughs, procedure catalogs, UI placement or implementation history.

## Workspace

Every package and app has its own `AGENTS.md`; read it before changing code there.

- `packages/core`: the trading domain. It holds market rules, candles and indicators, the broker, market data, investor flows, news, sentiment and web search contracts, risk checks, the `OrderDesk`, and research (reports, scored forecasts and the `ResearchDesk`)
- `packages/brokers`: one module per broker, the paper broker and Fubon
- `packages/market-data`: one module per market data provider, and the candle cache
- `packages/fundamentals`: one module per fundamentals and investor flows provider
- `packages/macro`: one module per source of economic release schedules
- `packages/news`: one module per news source
- `packages/web-search`: one module per web search vendor, which news and the agent search and read the web through
- `packages/decisions`: decisions models, which answer typed questions with probabilities, one module per vendor
- `packages/embeddings`: one module that speaks OpenAI's embeddings API, for OpenAI and for a model on this computer
- `packages/agent`: the trading agent on pi, with its runtime, tools, prompt, skills and the wire events the renderer folds into a conversation
- `packages/db`: SQLite schemas, migrations and repositories
- `packages/trading-chart`: domain-free React bindings for Lightweight Charts v5
- `packages/utils`: cross-runtime, domain-neutral utilities
- `packages/i18n`: translation catalogs, with `en-US` as the source locale
- `apps/desktop`: the Electron app
- `tools/oxlint/anti-slop`: vendored anti-slop Oxlint plugin; its source and local deviations are recorded in `UPSTREAM.md`

## Runtime boundaries

- The desktop's main process is the only backend and owns all I/O: broker SDKs, market data, news, LLM calls and secrets. The renderer makes no network requests and holds no keys, so a package module it imports does neither.
- Every key, model and endpoint comes from the user's settings. Modules pass every option an SDK would otherwise read from the environment.
- There is no local HTTP server. The only listeners are sign-in callbacks on `127.0.0.1`, each open only while its sign-in waits for the browser. A host for external clients, if one is added, binds to localhost, stays a thin layer over the packages and never exposes `confirm`.
- SQLite runs on the runtime's built-in `node:sqlite` through drizzle-orm, so the app ships no native modules.

## Trading invariants

1. **One road to an order:** `OrderDesk.propose` → `checkOrder` → the user confirms in the UI → `OrderDesk.confirm` → `broker.placeOrder`. Agent tools may only call `propose`, through a `ProposingDesk`; only a user action in the renderer reaches `confirm`, and no setting changes that. The desk is the broker's only holder and builds every check's context itself (session, account, the broker's markets); others read the account through it. MCP tools, and shell commands the user may switch on for a paper account, run outside the desk, so each call waits for the user unless the user's own approval settings let it run.
2. **Failed submissions are never retried:** `failed` is terminal, since the broker may have accepted the order anyway and a retry could duplicate it. A proposal still submitting when the app exits fails the next time the `OrderDesk` opens, for the same reason.
3. **Broker SDKs stay out of the repository and the installer:** users download SDKs such as `fubon-neo` themselves, and the app loads them at runtime from a path the user chooses.
4. **Secrets never persist in plain text:** certificates (`.pfx`), passwords and API keys never reach the repository, logs or error reports.
5. **No relay server:** market data and LLMs use the user's own keys, and data flows straight between the provider and the user's machine. Only the user can point a model provider at another endpoint, such as their gateway, or name one that receives the app's traces and logs. The project's own hosts the app reaches are its update feed, which is sent nothing about the user, and its Sentry, which gets crash reports only once the user agrees.
6. **Paper by default:** a live broker is wired into the `OrderDesk` in `services.ts` only after the user explicitly turns it on.

## Repository rules

- Write documentation and comments in English. UI copy lives in `@solyx/i18n` and reaches the renderer through `react-i18next`.
- Put dependency versions in the appropriate catalog in `pnpm-workspace.yaml`; package manifests reference catalog keys. Internal dependencies use `workspace:*`.
- `@solyx/*` packages export source and need no build step. Each `exports` key mirrors one module under `src/`; do not add a root export or sibling-only barrel.
- Take general-purpose helpers (debounce, memoize, retry, groupBy, …) from `es-toolkit`, imported from its root; `@solyx/utils` holds only what es-toolkit lacks.
- Import a symbol at the call site. Do not rename or re-export it through a local wrapper; wrap only when adding behavior.
- An enum is a PascalCase const object with PascalCase keys plus a same-named type, `export type Foo = (typeof Foo)[keyof typeof Foo]`; no TS `enum`, bare string-literal unions or `as const` arrays. Schemas derive from it (`z.enum(Foo)`) and untyped input narrows with `isEnumValue` from `@solyx/utils/is`.
- zod is imported as `import * as z from "zod"`. Schemas are camelCase with a `Schema` suffix, sit beside the const object or type they validate, and types derive from them with `z.infer`.
- A type assertion needs a `SAFETY:` comment; prefer narrowing, `satisfies` or a parser at the boundary so the assertion is not needed.
- A package that reads a source over HTTP (`market-data`, `fundamentals`, `macro`, `news`, `web-search`, `embeddings`) calls it through `ky` with an injectable `fetch` and parses every response with zod. A failure's message names the source and the reason it gives.
- Tests use synthetic payloads shaped like a source's responses; never commit recorded market data, pages, posts or articles.
- Oxlint, Oxfmt and Vitest come from Vite+; their lint, format and staged rules live in the root `vite.config.ts` because Vite+ ignores nested configs.
- `vp run` executes tasks in a clean environment, so most variables set outside it do not reach the task.
- Commit subjects and pull request titles follow Conventional Commits, `type(scope): summary`. The scope is the package or app that owns the change, as in `feat(desktop): …`, and is left out when the change spans several. GitHub builds each release's notes from the titles of the pull requests merged since the previous one.
- Work lands on `develop`, the default branch, through pull requests. `main` only points at the latest stable release; the release workflow moves it, and nothing is committed to it.

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
