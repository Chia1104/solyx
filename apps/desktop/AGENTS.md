# `@solyx/desktop`

The Electron app: the main process is the backend, the preload bridges it to the renderer, utility processes isolate native SDKs, and the renderer draws the workspace. Main process rules live in [`src/main/AGENTS.md`](src/main/AGENTS.md) and renderer rules in [`src/renderer/AGENTS.md`](src/renderer/AGENTS.md).

## Layout

`src` splits by process first, so each tsconfig keeps Node and DOM apart, then by module (`account`, `market`, `proposals`, `settings`, …). A module keeps one name across every process.

- `shared/rpc/<module>.contract.ts`: the module's oRPC contract, ending in `<module>Contract`: a zod schema for every input, since renderer input is untrusted, and `type<T>()` outputs. A procedure that takes one value takes it as its input, and one that takes several an object naming them. `router.contract.ts` only composes them, and the renderer imports only its type; imported as `#shared/*`.
- `shared/<module>.ts`: what either process reads of a module besides its contract, such as its shapes, enums, the schemas a form shares with its procedure, and helpers.
- `shared/ipc/<module>.ts`: the channel contract of a module not yet on oRPC, an `XxxApi` interface and `xxxChannels`, plus `XxxEvents` and `xxxEvents` for pushes from main. `solyx-api.ts` composes them into `window.solyx`.
- `main/modules/<module>/`: main-side logic and the module's procedures in `<module>.route.ts`, ending in `<module>Router`, built on `contractOS` from `main/rpc/context.ts`. A module still on channels has an object implementing `XxxApi` that `bindIpc(channels, schemas, handlers)` binds whole, parsing every argument with zod. What only Electron can do reaches a module through a small port, so it is tested without Electron.
- `main/rpc/`, `main/ipc/`, `main/shell/`, `main/scheduler.ts`, `main/services.ts`: the oRPC context, router and server, and the channel binding; the Electron shell, such as windows and the tray's icon; the one clock for periodic work; the composition root.
- `preload/index.ts`: forwards the port a window posts to the main process, and builds `window.solyx.<module>` from each channel module's channel and event maps through the contextBridge.
- `utility/<name>.ts`: a utility process's entry, beside the message contract the main process calls it through. Native SDKs that block or could crash run only in one.
- `worker/<name>.ts`: a worker thread's entry, built as its own bundle since a thread starts from a file, beside the message contract the main process starts it with where it has one. The agent's scripts run in one, and each backup and restore in another.
- `renderer/modules/<module>/`: the module's TanStack Query options, built from `orpc.<module>.<procedure>` and keyed by `orpc.<module>.key()` (a channel module's `xxxQueryKeys` and `xxxQuery()`), components, form schemas and hooks. An input is its query's key, so a listing in one passes through `symbolInput`, which keeps only what names it.
- `renderer/pages/`: route components that only compose modules.
- `renderer/components/`: module-neutral components composed from HeroUI, such as the error boundary fallback, the loading and error states every module renders, and the pane splitter, sheet, sections and symbol rows the workspace shares.
- `renderer/app/`: router, root layout, i18n, query client, theme and zod setup, and `rpc.ts`, the window's channel to the main process with its `client` and `orpc`, the client's TanStack Query utilities.

## Build and release

- Main, preload, utility processes and worker threads are bundled with `vp pack`, which inlines `@solyx/*`, so what the main bundle reads at runtime is copied beside it: each database's migrations for drizzle's migrator, QuickJS's wasm for the agent's scripts, the app icon `resources/icon.png`, and the tray's `trayTemplate` images, exported from `resources/tray.svg` in black on clear for macOS to tint. The renderer is built with `vp build`. The package workflow builds in the `release` environment, whose `SENTRY_DSN` the main bundle keeps and whose `SENTRY_AUTH_TOKEN` uploads the renderer's hidden source maps to Sentry; they are deleted before packaging, so none ship.
- `vp run package` packs those builds with electron-builder, configured in `build/`, into `release/`; they bundle every dependency but Electron, so the app ships no `node_modules`. The icon's source is `resources/icon.icon`, an Icon Composer document, so packaging for macOS needs Xcode 26 or later; `icon.png` and `icon.ico` are exported from its dark rendition, and the nightly icons differ only in their amber ink.
- A nightly is published on a schedule, at most one every six hours, from the newest commit on `develop` that passed CI, and only when that commit is ahead of the last nightly's. It is built from `build/electron-builder.nightly.yml` as Solyx Nightly, so it keeps its own data beside the stable app. A stable release is dispatched by hand and promotes the latest nightly's commit, so it only ships what nightly already ran; it then commits the version to `develop` and moves `main` to that commit. Versions are written into the build, and this package's `version` names the latest stable release. Each channel's update feed is uploaded after its installers, so it never names one not yet there.
- Until there are paid certificates the macOS app is ad-hoc signed and the Windows installer unsigned.

## IPC

- Adding or changing a procedure touches its contract, its route and its renderer call site together; a channel module's preload follows its channel map.
- Each window posts one end of a `MessageChannel`, which the preload forwards on `RPC_CONNECT` and the main process serves the router on, with the services and the asking window (`sender`) as context. oRPC is served over those ports alone, never over HTTP, and the main process makes no client of the router, so nothing but a window reaches `proposals.confirm`.
- A failure reaches the window with the main process's own message, which the renderer shows: the server turns any error that is not an `ORPCError` into one that keeps it, and input that does not parse into its issues in words.
- A module tells the windows that what it holds changed, whoever changed it (settings and secrets, market data sources, proposals, news), by publishing on the services' `windowEvents`; its `changes` procedure streams each to every window that follows it, until that window's port closes. A payload is an object, `{}` for a change that says nothing more. A channel module pushes with `webContents.send` on an event channel instead. The renderer refetches on either rather than guessing what a mutation reached; a query goes stale on its own only for what nothing pushes.
- The preload exposes each channel push as `onXxx(listener)`, which returns a function that stops listening, and never exposes `ipcRenderer` or a port itself. It also carries Sentry's bridge, which hands the renderer's crash reports to the main process. A channel handler that needs the asking window takes the invoke event as its last argument.
- A module may use another module's query keys to invalidate what it changes (a confirmed order refreshes `account`); anything shared more widely moves to a package.
- The main process asks for a place in the window, such as the one a row of the tray's menu names, through the workspace module: it keeps the destination and pushes that one waits, and a window takes it on the push and again as it loads, so a window opened for it shows it too.

## Identity, settings and secrets

- The app's name selects its `userData`, config folder and OS secret store entry. Unpackaged runs rename it to `<productName> Dev`, so development never touches an installed build's data or credentials; packaged channels are separated by the product name they are built with.
- `userData` holds secrets, caches and each database as its own file. Settings live in `~/.<app-name>/config.json` (`~/.solyx`, `~/.solyx-dev`, …), JSON a person may edit. Its `$schema` names the `config.schema.json` beside it, which the app generates from the zod schema it reads with and rewrites at start when it differs, so the file carries no comments and that schema documents every entry. The main process watches the file and applies saved edits without a restart, keeps entries it does not read when saving, reads an entry that no longer parses as its default and replaces it when saving beneath it, and never overwrites a file with syntax errors.
- The config folder also holds what the user writes for the agent, read afresh for every run: `skills/`, `AGENTS.md` and `mcp.json`, whose secrets are named `secret:NAME` and kept in the secret store. A skill shared through `~/.agents/skills` is offered only once it is listed in `agent.sharedSkills`.
- The config file and the secret store tell their listeners about every change, the app's own and a hand edit alike, so each module follows what it reads and a handler only saves.
- Secrets (provider keys, and the OAuth tokens of subscription and remote MCP sign-ins) are saved as ciphertext in `userData` with Electron's async `safeStorage` and decrypted only when a provider needs one. pi-ai and pi-mcp read and refresh them through a `CredentialStore` over the secret store. Where the OS has no secret store (Linux `basic_text`), nothing is saved.
- The renderer can save or delete a key and start, cancel or end a sign-in, but never reads a key back or sees a token.

## Appearance

- The appearance is a setting. The main process applies its theme through `nativeTheme.themeSource`, which the renderer's `prefers-color-scheme` follows, and pushes every change to the renderers, so the renderer never picks a scheme or price colours on its own.
- The language and the user's time zone are part of the appearance, since the main process writes in them too, as the tray's menu is. `resolveLocale` and `resolveTimeZone` turn the saved preferences into a catalog and a zone in either process, each against its own reading of the computer's, and `#shared/clock.ts` formats the app's own times for both.
- Palettes are sRGB hex in `shared/palette.ts`, since the chart canvas and Electron's window chrome accept nothing else. The user picks one per scheme, built in or their own from `appearance.palettes`, which sets colours over a built-in palette but never the price pair.
- The renderer writes the picked palettes as the CSS custom properties HeroUI reads before its first render; the charts and window chrome read them directly.
