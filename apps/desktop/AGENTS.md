# `@solyx/desktop`

The Electron app: the main process is the backend, the preload bridges it to the renderer, utility processes isolate native SDKs, and the renderer draws the workspace. Renderer rules live in [`src/renderer/AGENTS.md`](src/renderer/AGENTS.md).

## Layout

`src` splits by process first, so each tsconfig keeps Node and DOM apart, then by module (`account`, `market`, `proposals`, `settings`, …). A module keeps one name across every process.

| Path                                           | Holds                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/ipc/<module>.ts`                       | The module's IPC contract: an `XxxApi` interface and `xxxChannels`, plus `XxxEvents` and `xxxEvents` for pushes from main. `solyx-api.ts` composes them into `window.solyx`; imported as `#shared/*`                                                                                                               |
| `main/modules/<module>/`                       | Main-side logic and the module's handlers: an object implementing `XxxApi` that `bindIpc(channels, schemas, handlers)` binds whole, parsing every argument with zod because renderer input is untrusted. What only Electron can do reaches a handler object through a small port, so it is tested without Electron |
| `main/ipc/`, `main/shell/`, `main/services.ts` | IPC infrastructure and registration; the Electron shell, such as windows; the composition root                                                                                                                                                                                                                     |
| `preload/index.ts`                             | The contextBridge that builds `window.solyx.<module>` from each module's channel and event maps                                                                                                                                                                                                                    |
| `utility/<name>.ts`                            | A utility process's entry, beside the message contract the main process calls it through. Native SDKs that block or could crash run only in one                                                                                                                                                                    |
| `worker/<name>.ts`                             | A worker thread's entry, built as its own bundle since a thread starts from a file. The agent's analysis scripts run in one                                                                                                                                                                                        |
| `renderer/modules/<module>/`                   | The module's TanStack Query options (`xxxQueryKeys`, `xxxQuery()`), components, form schemas and hooks                                                                                                                                                                                                             |
| `renderer/pages/`                              | Route components that only compose modules                                                                                                                                                                                                                                                                         |
| `renderer/components/`                         | Module-neutral components composed from HeroUI: the error boundary fallback, the loading and error states every module renders, and the pane splitter, sheet, sections and symbol rows the workspace shares                                                                                                        |
| `renderer/app/`                                | Router, root layout, i18n, query client, theme and zod setup                                                                                                                                                                                                                                                       |

- Main, preload, utility processes and worker threads are bundled with `vp pack`, which inlines `@solyx/*` and copies beside the main bundle what it reads at runtime: each database's migrations for drizzle's migrator, and QuickJS's wasm for the agent's analysis scripts; the renderer is built with `vp build`.

## IPC

- Adding or changing a channel touches its contract, its handler and its renderer call site together; the preload follows the channel map.
- A module pushes with `webContents.send` on an event channel whenever what it holds changes, whoever changed it (settings and secrets, market data sources, proposals, news). The renderer refetches on a push rather than guessing what a mutation reached; a query goes stale on its own only for what nothing pushes.
- The preload exposes each push as `onXxx(listener)`, which returns a function that stops listening, and never exposes `ipcRenderer` itself. A handler that needs the asking window takes the invoke event as its last argument.
- A module may use another module's query keys to invalidate what it changes (a confirmed order refreshes `account`); anything shared more widely moves to a package.

## Identity, settings and secrets

- The app's name selects its `userData`, config folder and OS secret store entry. Unpackaged runs rename it to `<productName> Dev`, so development never touches an installed build's data or credentials; packaged channels are separated by the product name they are built with.
- `userData` holds secrets, caches and each database as its own file. Settings live in `~/.<app-name>/config.jsonc` (`~/.solyx`, `~/.solyx-dev`, …), JSONC a person may edit. The main process watches it and applies saved edits without a restart, edits values in place so comments survive, reads an entry that no longer parses as its default and replaces it when saving beneath it, and never overwrites a file with syntax errors.
- The config folder also holds what the user writes for the agent, read afresh for every run: `skills/`, `AGENTS.md` and `mcp.json`, whose secrets are named `secret:NAME` and kept in the secret store. A skill shared through `~/.agents/skills` is offered only once it is listed in `agent.sharedSkills`.
- The config file and the secret store tell their listeners about every change, the app's own and a hand edit alike, so each module follows what it reads and a handler only saves.
- Secrets (provider keys, and the OAuth tokens of subscription and remote MCP sign-ins) are saved as ciphertext in `userData` with Electron's async `safeStorage` and decrypted only when a provider needs one. pi-ai and pi-mcp read and refresh them through a `CredentialStore` over the secret store. Where the OS has no secret store (Linux `basic_text`), nothing is saved.
- The renderer can save or delete a key and start, cancel or end a sign-in, but never reads a key back or sees a token.

## Main process

- MCP servers in `mcp.json` run as the main process's child processes or are reached over HTTP, and close when the app quits; `@solyx/agent` owns how they connect.
- The agent's models come from the providers the user switched on in `agent.providers`, plus the default model's provider, which is always on. `agent.provider`, `agent.model` and `agent.thinking` name the default a conversation runs on until it picks its own, and a provider's models run only once its key is saved or its subscription signed in.
- The agent's shell is off until `agent.shell` is switched on, and stays off whatever that says while the desk trades a live account. Each conversation's commands work in its own folder under `userData/agent-workspaces`, erased with the conversation.
- Sign-in callbacks: Sign in with ChatGPT listens on port 1455, a remote MCP server's sign-in on the port its client registration redirects to, and each takes any free port when that one is taken.
- Market data providers enforce the limits of the user's plan, so the main process keeps one provider per credential and plan. The config file picks each market's source; the market module follows the settings and keys, reopens the stream when they change and tells windows to load and watch again.
- The `live-candles` hub keeps each watched symbol's session of minute bars from a `MarketDataStream`, folds them into the intervals windows watch and pushes whole bars, so the renderer only upserts them by time. Only today's session is pushed; closed sessions come from history through the candle cache.
- Fubon's SDK runs only in a utility process of its own, one per sign-in: its calls block until Fubon answers, its native code could crash, and it logs the ID number and account details to `./log` with no setting for it, so that process works from a folder in `userData`. The main process sends it the decrypted credentials over its message port, ends it when Fubon does not answer in time, signs in once per saved settings on first use, and keeps a failed sign-in instead of retrying until the settings change or the user asks, since repeated failures could lock the account.
- The news module is the one `NewsDesk` the agent's `get_news` reads through. It collects into `news.sqlite` on request and, for watched listings, every `news.collectEveryHours` hours (0 turns it off). Every search records its source's health: scheduled refreshes rest a source that keeps failing, while `get_news` always tries every source. Windows hear once per collection, and each story is scored once per listing by the decisions model the user set up.

## Appearance

- The appearance is a setting. The main process applies its theme through `nativeTheme.themeSource`, which the renderer's `prefers-color-scheme` follows, and pushes every change to the renderers, so the renderer never picks a scheme or price colours on its own.
- Palettes are sRGB hex in `shared/palette.ts`, since the chart canvas and Electron's window chrome accept nothing else. The user picks one per scheme, built in or their own from `appearance.palettes`, which sets colours over a built-in palette but never the price pair.
- The renderer writes the picked palettes as the CSS custom properties HeroUI reads before its first render; the charts and window chrome read them directly.
