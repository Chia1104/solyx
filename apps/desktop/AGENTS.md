# `@solyx/desktop`

The Electron app: the main process is the backend, the preload bridges it to the renderer, utility processes isolate native SDKs, and the renderer draws the workspace. Main process rules live in [`src/main/AGENTS.md`](src/main/AGENTS.md) and renderer rules in [`src/renderer/AGENTS.md`](src/renderer/AGENTS.md).

## Layout

`src` splits by process first, so each tsconfig keeps Node and DOM apart, then by module (`account`, `market`, `proposals`, `settings`, …). A module keeps one name across every process.

- `shared/ipc/<module>.ts`: the module's IPC contract, an `XxxApi` interface and `xxxChannels`, plus `XxxEvents` and `xxxEvents` for pushes from main. `solyx-api.ts` composes them into `window.solyx`; imported as `#shared/*`.
- `main/modules/<module>/`: main-side logic and the module's handlers, an object implementing `XxxApi` that `bindIpc(channels, schemas, handlers)` binds whole, parsing every argument with zod because renderer input is untrusted. What only Electron can do reaches a handler object through a small port, so it is tested without Electron.
- `main/ipc/`, `main/shell/`, `main/scheduler.ts`, `main/services.ts`: IPC infrastructure and registration; the Electron shell, such as windows and the tray's icon; the one clock for periodic work; the composition root.
- `preload/index.ts`: the contextBridge that builds `window.solyx.<module>` from each module's channel and event maps.
- `utility/<name>.ts`: a utility process's entry, beside the message contract the main process calls it through. Native SDKs that block or could crash run only in one.
- `worker/<name>.ts`: a worker thread's entry, built as its own bundle since a thread starts from a file. The agent's scripts run in one.
- `renderer/modules/<module>/`: the module's TanStack Query options (`xxxQueryKeys`, `xxxQuery()`), components, form schemas and hooks.
- `renderer/pages/`: route components that only compose modules.
- `renderer/components/`: module-neutral components composed from HeroUI, such as the error boundary fallback, the loading and error states every module renders, and the pane splitter, sheet, sections and symbol rows the workspace shares.
- `renderer/app/`: router, root layout, i18n, query client, theme and zod setup.

## Build and release

- Main, preload, utility processes and worker threads are bundled with `vp pack`, which inlines `@solyx/*`, so what the main bundle reads at runtime is copied beside it: each database's migrations for drizzle's migrator, QuickJS's wasm for the agent's scripts, the app icon `resources/icon.png`, and the tray's `trayTemplate` images, exported from `resources/tray.svg` in black on clear for macOS to tint. The renderer is built with `vp build`. The package workflow builds in the `release` environment, whose `SENTRY_DSN` the main bundle keeps and whose `SENTRY_AUTH_TOKEN` uploads the renderer's hidden source maps to Sentry; they are deleted before packaging, so none ship.
- `vp run package` packs those builds with electron-builder, configured in `build/`, into `release/`; they bundle every dependency but Electron, so the app ships no `node_modules`. The icon's source is `resources/icon.icon`, an Icon Composer document, so packaging for macOS needs Xcode 26 or later; `icon.png` and `icon.ico` are exported from its dark rendition, and the nightly icons differ only in their amber ink.
- Every push to `develop` that passes CI publishes a nightly, built from `build/electron-builder.nightly.yml` as Solyx Nightly, so it keeps its own data beside the stable app. A stable release is dispatched by hand and promotes the latest nightly's commit, so it only ships what nightly already ran; it then commits the version to `develop` and moves `main` to that commit. Versions are written into the build, and this package's `version` names the latest stable release. Each channel's update feed is uploaded after its installers, so it never names one not yet there.
- Until there are paid certificates the macOS app is ad-hoc signed and the Windows installer unsigned.

## IPC

- Adding or changing a channel touches its contract, its handler and its renderer call site together; the preload follows the channel map.
- A module pushes with `webContents.send` on an event channel whenever what it holds changes, whoever changed it (settings and secrets, market data sources, proposals, news). The renderer refetches on a push rather than guessing what a mutation reached; a query goes stale on its own only for what nothing pushes.
- The preload exposes each push as `onXxx(listener)`, which returns a function that stops listening, and never exposes `ipcRenderer` itself. It also carries Sentry's bridge, which hands the renderer's crash reports to the main process. A handler that needs the asking window takes the invoke event as its last argument.
- A module may use another module's query keys to invalidate what it changes (a confirmed order refreshes `account`); anything shared more widely moves to a package.

## Identity, settings and secrets

- The app's name selects its `userData`, config folder and OS secret store entry. Unpackaged runs rename it to `<productName> Dev`, so development never touches an installed build's data or credentials; packaged channels are separated by the product name they are built with.
- `userData` holds secrets, caches and each database as its own file. Settings live in `~/.<app-name>/config.json` (`~/.solyx`, `~/.solyx-dev`, …), JSON a person may edit. Its `$schema` names the `config.schema.json` beside it, which the app generates from the zod schema it reads with and rewrites at start when it differs, so the file carries no comments and that schema documents every entry. The main process watches the file and applies saved edits without a restart, keeps entries it does not read when saving, reads an entry that no longer parses as its default and replaces it when saving beneath it, and never overwrites a file with syntax errors.
- The config folder also holds what the user writes for the agent, read afresh for every run: `skills/`, `AGENTS.md` and `mcp.json`, whose secrets are named `secret:NAME` and kept in the secret store. A skill shared through `~/.agents/skills` is offered only once it is listed in `agent.sharedSkills`.
- The config file and the secret store tell their listeners about every change, the app's own and a hand edit alike, so each module follows what it reads and a handler only saves.
- Secrets (provider keys, and the OAuth tokens of subscription and remote MCP sign-ins) are saved as ciphertext in `userData` with Electron's async `safeStorage` and decrypted only when a provider needs one. pi-ai and pi-mcp read and refresh them through a `CredentialStore` over the secret store. Where the OS has no secret store (Linux `basic_text`), nothing is saved.
- The renderer can save or delete a key and start, cancel or end a sign-in, but never reads a key back or sees a token.

## Appearance

- The appearance is a setting. The main process applies its theme through `nativeTheme.themeSource`, which the renderer's `prefers-color-scheme` follows, and pushes every change to the renderers, so the renderer never picks a scheme or price colours on its own.
- The language is part of the appearance, since the main process writes in it too, as the tray's menu is. `resolveLocale` turns the saved preference into a catalog in either process, each against its own reading of the computer's language.
- Palettes are sRGB hex in `shared/palette.ts`, since the chart canvas and Electron's window chrome accept nothing else. The user picks one per scheme, built in or their own from `appearance.palettes`, which sets colours over a built-in palette but never the price pair.
- The renderer writes the picked palettes as the CSS custom properties HeroUI reads before its first render; the charts and window chrome read them directly.
