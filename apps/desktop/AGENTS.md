# `@solyx/desktop`

The Electron app: the main process starts the backend in a utility process and draws the windows and the tray, the preload bridges a window to the backend, other utility processes isolate native code, and each window loads `@solyx/webapp`. Contracts live in [`packages/api/AGENTS.md`](../../packages/api/AGENTS.md), backend rules in [`packages/backend/AGENTS.md`](../../packages/backend/AGENTS.md), main process rules in [`src/main/AGENTS.md`](src/main/AGENTS.md) and renderer rules in [`apps/webapp/AGENTS.md`](../webapp/AGENTS.md).

## Layout

`src` splits by process first, so each tsconfig keeps Node and DOM apart, then by module (`account`, `market`, `proposals`, …). A module keeps one name across every process and package.

- `utility/<name>.ts` is a utility process's entry, beside `<name>.contract.ts`, the oRPC contract it serves on the port the main process hands it. `utility/backend-host.ts` implements the backend's `Host` by asking the main process over `utility/host.contract.ts`.
- Native code runs only in a utility process of its own, which the main process starts when the backend asks and hands no port but the backend's: Fubon's SDK, since its calls block and it could crash, and the kernel, since it could crash and loads from outside the `app.asar` the fuses check.

## Build and release

- Main, preload, utility processes and the backend's worker threads (`@solyx/backend/worker/*`) are bundled with `vp pack`, which inlines `@solyx/*`, so what a bundle reads at runtime is copied beside it: beside the backend's, in `dist/utility`, each database's migrations, QuickJS's and Photon's wasm, pdf.js's CMaps and the kernel's native build, which electron-builder keeps beside the `app.asar`, since a native module loads only from a file of its own; beside the main process's, the app icon and the tray's `trayTemplate` images, exported from `resources/tray.svg` in black on clear for macOS to tint. The `build` task builds `@solyx/kernel` and `@solyx/webapp` first and copies the renderer into `dist/renderer`.
- The package workflow builds in the `release` environment, whose `SENTRY_DSN` the main bundle keeps; the renderer's hidden source maps are uploaded to Sentry and deleted before packaging, so none ship.
- `vp run package` packs with electron-builder, configured in `build/`, into `release/`; the bundles carry every dependency but Electron, so the app ships no `node_modules`. The icon's source is `resources/icon.icon`, an Icon Composer document, so packaging for macOS needs Xcode 26 or later; `icon.png` and `icon.ico` are exported from its dark rendition, and the nightly icons differ only in their amber ink.
- A nightly is published on a schedule, at most one every six hours, from the newest commit on `develop` that passed CI, and only when it is ahead of the last nightly's. It is built from `build/electron-builder.nightly.yml` as Solyx Nightly, so it keeps its own data beside the stable app. A stable release is dispatched by hand and promotes the latest nightly's commit, so it only ships what nightly already ran; it then commits the version to `develop` and moves `main` to that commit. Versions are written into the build, and this package's `version` names the latest stable release. Each channel's update feed is uploaded after its installers, so it never names one not yet there.
- Until there are paid certificates the macOS app is ad-hoc signed and the Windows installer unsigned.
- A packaged app's fuses turn off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and the inspector, and load app code only from the `app.asar` whose hash the binary carries, since its binary unseals every secret; Node work off the main thread runs in a utility process or a worker thread, never in a copy of Electron run as Node. The macOS app runs under the hardened runtime with `build/entitlements.mac.plist`, which allows V8's JIT and turns off library validation, since an ad-hoc signature has no team ID and the broker SDK is signed by its vendor.
- Only a development run and the test package accept remote debugging; a stable or nightly build quits before it opens anything when started with `--remote-debugging-port` or `--remote-debugging-pipe`, since the protocol drives a window that can confirm orders. `vp run package:test` packs an unpublished, unpacked Solyx Test from `build/electron-builder.test.yml`, with the stable app's fuses and hardened runtime but its own name, data and secrets, and no update feed, for smoke runs over the DevTools protocol; the release and nightly workflows never build it. A packaged build's version names its channel (`-nightly.`, `-test`), so the channel is fixed in the `app.asar` the fuses validate and no flag or variable changes it at launch.

## IPC

- Adding or changing a procedure touches its contract, its route and its renderer call site together.
- Each window posts one end of a `MessageChannel`, which the preload forwards on `RPC_CONNECT` and the main process hands to the backend, which serves the router on it with the window as `client`, by its page's `webContents` id. A paired browser reaches the router over the backend's edge instead, and only what its contracts mark for devices; nothing but a window reaches `proposals.confirm`, and the main process makes no client of the router.
- The preload never exposes `ipcRenderer` or a port to the page; besides the port it carries only Sentry's bridge, which hands the renderer's crash reports to the main process.
- A failure reaches the window with the backend's own message, which the renderer shows: the server turns any error that is not an `ORPCError` into one that keeps it, and input that does not parse into its issues in words.
- A module tells the windows that what it holds changed, whoever changed it, by publishing on the services' `windowEvents`, which its `changes` procedure streams to every window that follows it until that window's port closes. A payload is an object, `{}` for a change that says nothing more. A stream whose every event matters, as the agent's runs do, keeps all it has not sent yet rather than the publisher's last hundred. The renderer refetches on a change rather than guessing what a mutation reached; a query goes stale on its own only for what nothing pushes.
- A module may use another module's query keys to invalidate what it changes (a confirmed order refreshes `account`); anything shared more widely moves to a package.
- The backend asks for a place in the window, such as one a row of the tray's menu names, through the workspace module, which keeps the destination and pushes that one waits; a window takes it on the push and again as it loads, so a window opened for it shows it too.

## Identity

- The app's name selects its `userData`, its config folder `~/.<app-name>` and its OS secret store entry. Unpackaged runs rename it to `<productName> Dev`, so development never touches an installed build's data or credentials; packaged channels are separated by their product names.

## Appearance

- The appearance is a setting. The backend has the main process apply its theme through `nativeTheme.themeSource`, which the renderer's `prefers-color-scheme` follows, and pushes every change to the renderers, so the renderer never picks a scheme or price colours on its own.
- The language and the user's time zone are part of the appearance, since the backend writes in them too, as in the tray's menu. `resolveLocale` and `resolveTimeZone` resolve the saved preferences in either process against its own reading of the computer's, and `@solyx/api/clock` formats the app's own times for both.
- Palettes are sRGB hex in `@solyx/api/palette`, since the chart canvas and Electron's window chrome accept nothing else. The user picks one per scheme, built in or their own from `appearance.palettes`, which sets colours over a built-in palette but never the price pair.
- The renderer writes the picked palettes as the CSS custom properties HeroUI reads before its first render; the charts read them directly, and the window paints its own background and controls in the palette's background, so the window and the page agree.
