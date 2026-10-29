# Solyx

Personal desktop app for trading Taiwan and US stocks: an agent analyzes and proposes trades, and every order waits for the user to confirm it unless it falls within a trading mandate the user set. Open source, local-first and bring-your-own-key, with no paid tier. It has one maintainer and no external consumers of internal APIs.

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
- `packages/fundamentals`: one module per provider of fundamentals, investor flows, the exchanges' own lists and what listed funds report
- `packages/macro`: one module per source of economic release schedules and of the indicators' figures, and of the rate between the app's two currencies
- `packages/news`: one module per news source
- `packages/web-search`: one module per web search vendor, which news and the agent search and read the web through
- `packages/decisions`: decisions models, which answer typed questions with probabilities, one module per vendor
- `packages/embeddings`: one module that speaks OpenAI's embeddings API, for OpenAI and for a model on this computer, and one that checks for and downloads Ollama's models
- `packages/backup`: one module that speaks S3's API, and the sealed bundle a backup is kept as
- `packages/kernel`: the backtests' native core, in Rust on napi-rs, which runs what `@solyx/core/backtest` prepares
- `packages/agent`: the trading agent on pi, with its runtime, tools, prompt, skills and the wire events the renderer folds into a conversation
- `packages/api`: the backend's oRPC contracts, and what the backend and its clients share besides them
- `packages/backend`: the backend: the services, their procedures, the scheduler and the `Host` port through which it reaches the process that runs it
- `packages/db`: SQLite schemas, migrations and repositories
- `packages/trading-chart`: domain-free React bindings for Lightweight Charts v5
- `packages/utils`: cross-runtime, domain-neutral utilities
- `packages/i18n`: translation catalogs, with `en-US` as the source locale
- `apps/desktop`: the Electron app
- `apps/webapp`: the renderer, the workspace's React app that the desktop's windows load
- `apps/website`: the landing page and docs, prerendered and deployed to Cloudflare Workers through Void
- `tools/oxlint/anti-slop`: vendored anti-slop Oxlint plugin; its source and local deviations are recorded in `UPSTREAM.md`

## Runtime boundaries

- The desktop's backend, a utility process its main process starts, is the only backend and owns all I/O: broker SDKs, market data, news, LLM calls and secrets. It reaches Electron only through a port the main process serves, which alone holds the OS key that seals the secrets. The renderer makes no network request but to the backend that serves it and holds no key but a paired browser's own token, so a package module it imports does neither.
- Every key, model and endpoint comes from the user's settings. Modules pass every option an SDK would otherwise read from the environment.
- The one HTTP server is the backend's edge, off until the user switches it on. It binds `127.0.0.1`, answers only requests that name this computer, serves the renderer's build and, to browsers the user paired, the router over a WebSocket, and a paired browser reaches only the procedures its contract marks for devices, which send or cancel an order only with a signature from the passkey it added as it paired. The only other listeners are sign-in callbacks on `127.0.0.1`, each open only while its sign-in waits for the browser, and the proxies of the app's sandbox, which the agent's shell commands and the code of the user's strategies run in, on `127.0.0.1` or Unix sockets, which refuse every host and stay from the first sandboxed command or run until the app quits.
- SQLite runs on the runtime's built-in `node:sqlite` through drizzle-orm. The one native module the app ships is `@solyx/kernel`, built from this repository and loaded only in a utility process of its own.

## Trading invariants

1. **One road to an order:** `OrderDesk.propose` → `checkOrder` → the user confirms in the UI → `OrderDesk.confirm` → `broker.placeOrder`. A proposal keeps the session it was made for and the price then, and confirming it after that session or once the price has moved past `MAX_PREMISE_MOVE` refuses it, so it is proposed again on what the market says now. Agent tools may only call `propose`, through a `ProposingDesk`; only a user action reaches `confirm`, or `cancel`, which asks the broker to cancel an order: in one of the app's windows, or in a browser the user paired, whose passkey, unlocked by the user, signs that one action on that one proposal or order. The one other way to `broker.placeOrder` is the user's trading mandate: the desk sends an agent's proposal itself where it passed every check and the mandate covers it, a limit order within the listings, sides, values and days the user set for that one account at the broker. Only the user sets a mandate, in one of the app's windows, and it is sealed with the secrets, so neither the agent nor an edit of the app's files can make or widen one; a new one is in shadow, marking what it would send, unless the user switches that off as they set it. An exit, a sale of shares held that the broker sends itself once the price falls to a stop or rises to a target, takes the same road: confirming it has the broker watch the price, the mandate never sends one, and once one of its prices sells the desk cancels the other. The desk is the broker's only holder and builds every check's context itself (session, account, the broker's markets); others read the account through it. MCP tools, shell commands the user may switch on for a paper account, and the code of the user's strategies run outside the desk, so each call waits for the user unless the user's own approval settings let it run. A strategy's code only works out the lines the engine's rules trade on in a backtest, one version at a time once it is allowed, and outside the sandbox beside a live account only on a version the user allowed themselves.
2. **Failed submissions are never retried:** nothing sends a `failed` proposal again. Unless the broker answered that it refused the order (`OrderRefusedError`), it may have accepted it anyway and a retry could duplicate it. A proposal still submitting when the app exits fails the next time the `OrderDesk` opens, for the same reason. Every order carries its proposal's tag, so the desk looks for such an order in the broker's orders: one it finds is submitted after all, and one the broker does not list once its session is over was never placed. A check that fails before the order is sent, or an exit during it, sends nothing, so the proposal waits for the user again. One that waits in a backup is dismissed as the desk opens on the restored data, since the user may have confirmed it after the backup was made.
3. **Broker SDKs stay out of the repository and the installer:** users download SDKs such as `fubon-neo` themselves, and the app loads them at runtime from a path the user chooses.
4. **Secrets never persist in plain text:** certificates (`.pfx`), passwords and API keys never reach the repository, logs, error reports or a backup.
5. **No relay server:** market data and LLMs use the user's own keys, and data flows straight between the provider and the user's machine. Only the user can point a model provider at another endpoint, such as their gateway, name one that receives the app's traces and logs, or name the bucket that receives the app's backups, each sealed under the user's passphrase before it leaves the computer. The project's own hosts the app reaches are its update feed, which is sent nothing about the user, and its Sentry, which gets crash reports only once the user agrees.
6. **Paper by default:** a live broker is wired into the `OrderDesk` in `services.ts` only after the user explicitly turns it on.

## Repository rules

- Write documentation and comments in English. UI copy lives in `@solyx/i18n` and reaches the renderer through `react-i18next`.
- Put dependency versions in the appropriate catalog in `pnpm-workspace.yaml`; package manifests reference catalog keys. Internal dependencies use `workspace:*`. A dependency's own bug is fixed with `pnpm patch` only until upstream fixes it, with why beside `patchedDependencies`.
- `@solyx/*` packages export source and need no build step, except `@solyx/kernel`, whose Rust `vp run @solyx/kernel#build` compiles; a task that loads it depends on that build, and its crates are pinned in its `Cargo.lock`. Each `exports` key mirrors one module under `src/`; do not add a root export or sibling-only barrel.
- Take general-purpose helpers (debounce, memoize, retry, groupBy, …) from `es-toolkit`, imported from its root; `@solyx/utils` holds only what es-toolkit lacks. The renderer's components pace what they drive, debouncing and throttling, with `@tanstack/react-pacer`'s hooks instead, which end with the component.
- Import a symbol at the call site. Do not rename or re-export it through a local wrapper; wrap only when adding behavior.
- An enum is a PascalCase const object with PascalCase keys plus a same-named type, `export type Foo = (typeof Foo)[keyof typeof Foo]`; no TS `enum`, bare string-literal unions or `as const` arrays. Schemas derive from it (`z.enum(Foo)`) and untyped input narrows with `isEnumValue` from `@solyx/utils/is`.
- zod is imported as `import * as z from "zod"`. Schemas are camelCase with a `Schema` suffix, sit beside the const object or type they validate, and types derive from them with `z.infer`.
- A type assertion needs a `SAFETY:` comment; prefer narrowing, `satisfies` or a parser at the boundary so the assertion is not needed.
- A package that reads a source over HTTP (`market-data`, `fundamentals`, `macro`, `news`, `web-search`, `embeddings`, `backup`) calls it through `ky` with an injectable `fetch` and parses every response with zod. A failure's message names the source and the reason it gives.
- Read a site's terms of use and `robots.txt` before adding it as a source, and add none that forbids programs from downloading its data. The Taiwan Stock Exchange's websites (`www.twse.com.tw`, `mis.twse.com.tw`) do, so only what it publishes as open data (`openapi.twse.com.tw`) is read; what only those sites hold, such as a fund's estimated net asset value, the agent finds on the issuer's own pages.
- Tests use synthetic payloads shaped like a source's responses; never commit recorded market data, pages, posts or articles.
- Oxlint, Oxfmt and Vitest come from Vite+; their lint, format and staged rules live in the root `vite.config.ts` because Vite+ ignores nested configs.
- `vp run` executes tasks in a clean environment, so most variables set outside it do not reach the task.
- Fallow analyzes the repository for unused code and dependencies, import cycles, duplication and complexity; `.fallowrc.jsonc` says why each setting departs from its defaults. Run `fallow audit` before a commit: CI's `audit` job fails a pull request on the findings it introduces. No hook runs it for agents, since a committed hook would run repository code on every shell call. The MCP registrations run `fallow-mcp` from `PATH`, because `npx` refuses the root's `devEngines`. So `fallow agent install` runs with `--without hooks --without guide --without mcp`.
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
