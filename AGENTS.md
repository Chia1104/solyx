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
- Each `AGENTS.md` records the boundaries and invariants of the code beneath it; put a rule in the nearest one that covers all the code it governs. Update it when a seam changes, not when a feature ships, and write only current rules: no walkthroughs, procedure catalogs, UI placement or implementation history.

## Workspace

Every package and app has its own `AGENTS.md`; read it before changing code there.

| Path                     | Role                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`          | The trading domain: market rules, candles and indicators, the broker, market data, news and sentiment contracts, risk checks and the `OrderDesk` |
| `packages/brokers`       | One module per broker: the paper broker and Fubon                                                                                                |
| `packages/market-data`   | One module per market data provider, and the candle cache                                                                                        |
| `packages/news`          | One module per news source                                                                                                                       |
| `packages/decisions`     | Decisions models, which answer typed questions with probabilities, one module per vendor                                                         |
| `packages/agent`         | The trading agent on pi: runtime, tools, prompt, skills and the wire events the renderer folds into a conversation                               |
| `packages/db`            | SQLite schemas, migrations and repositories                                                                                                      |
| `packages/trading-chart` | Domain-free React bindings for Lightweight Charts v5                                                                                             |
| `packages/utils`         | Cross-runtime, domain-neutral utilities                                                                                                          |
| `packages/i18n`          | Translation catalogs, `en-US` as the source locale                                                                                               |
| `apps/desktop`           | The Electron app                                                                                                                                 |
| `tools/oxlint/anti-slop` | Vendored anti-slop Oxlint plugin; its source and local deviations are recorded in `UPSTREAM.md`                                                  |

## Runtime boundaries

- The desktop's main process is the only backend and owns all I/O: broker SDKs, market data, news, LLM calls and secrets. The renderer makes no network requests and holds no keys.
- Every key, model and endpoint comes from the user's settings. Modules pass every option an SDK would otherwise read from the environment.
- There is no local HTTP server. The only listeners are sign-in callbacks on `127.0.0.1`, each open only while its sign-in waits for the browser. A host for external clients, if one is added, binds to localhost, stays a thin layer over the packages and never exposes `confirm`.
- SQLite runs on the runtime's built-in `node:sqlite` through drizzle-orm, so the app ships no native modules.

## Trading invariants

1. **One road to an order:** `OrderDesk.propose` → `checkOrder` → the user confirms in the UI → `OrderDesk.confirm` → `broker.placeOrder`. Agent tools may only call `propose`; `confirm` is reachable only from a user action in the renderer. The desk is the broker's only holder and builds every check's context itself (session, account, the broker's markets); others read the account through it, and the agent gets a `ProposingDesk`. Tools from MCP servers run outside the `OrderDesk`, so each of their calls waits for the user to allow it, unless the user lets a tool its server marks read-only run on its own. Shell commands, which the user may switch on for a paper account, run outside it too, and every one waits for the user.
2. **Failed submissions are never retried:** `failed` is terminal, since the broker may have accepted the order anyway and a retry could duplicate it. A proposal still submitting when the app exits fails the next time the `OrderDesk` opens, for the same reason.
3. **Broker SDKs stay out of the repository and the installer:** users download SDKs such as `fubon-neo` themselves, and the app loads them at runtime from a path the user chooses.
4. **Secrets never persist in plain text:** certificates (`.pfx`), passwords and API keys never reach the repository, logs or error reports.
5. **No relay server:** market data and LLMs use the user's own keys, and data flows straight from the provider to the user's machine.
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
