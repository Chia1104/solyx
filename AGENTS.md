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

| Path                                  | Role                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` (`@solyx/core`)       | Market rules (tick sizes, board and odd lots, trading sessions), the `checkOrder` risk checks, the `BrokerAdapter` contract and the `OrderDesk` order flow                                   |
| `packages/brokers` (`@solyx/brokers`) | One module per broker. `./paper` is the paper broker and the only one the app wires today; `./fubon` loads the user's own Fubon SDK at runtime and does not implement accounts or orders yet |
| `packages/utils` (`@solyx/utils`)     | Cross-runtime, domain-neutral utilities; boundaries in [`packages/utils/AGENTS.md`](packages/utils/AGENTS.md)                                                                                |
| `apps/desktop` (`@solyx/desktop`)     | Electron. `src/main` hosts the core and brokers, `src/preload` exposes `window.solyx` through contextBridge, `src/renderer` is the React UI and `src/shared/ipc.ts` is the IPC contract      |
| `tools/oxlint/anti-slop`              | Vendored anti-slop Oxlint plugin; its source and local deviations are recorded in `UPSTREAM.md`                                                                                              |

- Desktop main and preload are bundled with `vp pack`, which inlines `@solyx/*`; the renderer is built with `vp build`.
- Change the three sides of the IPC contract together: `src/shared/ipc.ts` (types and channels), `src/preload/index.ts` and `src/main/ipc.ts`.

## Trading invariants

1. **One road to an order:** `OrderDesk.propose` → `checkOrder` → the user confirms in the UI → `OrderDesk.confirm` → `broker.placeOrder`. Agent tools may only call `propose`; `confirm` is reachable only from a user action in the renderer. Nothing else calls `broker.placeOrder`.
2. **Failed submissions are never retried:** `failed` is terminal. The broker may have accepted the order anyway, so a retry could duplicate it.
3. **Broker SDKs stay out of the repository and the installer:** users download SDKs such as `fubon-neo` themselves, and the app loads them at runtime from a path the user chooses.
4. **Secrets never persist in plain text:** certificates (`.pfx`), passwords and API keys never reach the repository, logs or error reports.
5. **No relay server:** market data and LLMs use the user's own keys, and data flows straight from the provider to the user's machine.
6. **Paper by default:** a live broker is wired into the `OrderDesk` in `services.ts` only after the user explicitly turns it on.

## Repository rules

- Write documentation, comments and UI copy in English.
- Put dependency versions in the appropriate catalog in `pnpm-workspace.yaml`; package manifests reference catalog keys. Internal dependencies use `workspace:*`.
- `@solyx/*` packages export source and need no build step. Each `exports` key mirrors one module under `src/`; do not add a root export or sibling-only barrel.
- Import a symbol at the call site. Do not rename or re-export it through a local wrapper; wrap only when adding behavior.
- An enum is a PascalCase const object with PascalCase keys plus a same-named type, `export type Foo = (typeof Foo)[keyof typeof Foo]`; no TS `enum`, bare string-literal unions or `as const` arrays. Untyped input narrows with `isEnumValue` from `@solyx/utils/is`.
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
