import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { debounce, omit } from "es-toolkit";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

import packageJson from "./package.json" with { type: "json" };

const MAIN_BUNDLE = "dist/main/index.mjs";

const PRELOAD_BUNDLE = "dist/preload/index.cjs";

// Set by scripts/dev.mjs, which picks the dev server's port with it. Electron then loads the
// renderer from the dev server and restarts after every successful main/preload build.
const rendererUrl = process.env.SOLYX_RENDERER_URL;

const isDev = Boolean(rendererUrl);

// Set only by the package workflow, which uploads the renderer's source maps so Sentry can read its
// minified stacks, and deletes them so they never ship.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

const uploadSourceMaps = sentryAuthToken
  ? sentryVitePlugin({
      authToken: sentryAuthToken,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      telemetry: false,
      // Named as the main process names its reports. Maps match by the debug ids injected into the
      // bundle, so the release is not injected.
      release: { name: `solyx@${packageJson.version}`, inject: false },
      sourcemaps: {
        filesToDeleteAfterUpload: join(
          import.meta.dirname,
          "dist/renderer/**/*.map"
        ),
      },
    })
  : [];

let electron: ChildProcess | undefined;

// Main and preload build in parallel; debounce so one change restarts Electron once.
const restartElectron = debounce(() => {
  if (!existsSync(MAIN_BUNDLE) || !existsSync(PRELOAD_BUNDLE)) return;
  electron?.kill();
  // SAFETY: outside Electron, the `electron` package's entry exports the path to its binary.
  const electronBinary = createRequire(import.meta.url)("electron") as string;
  // Terminals hosted by Electron apps export this, which would boot Electron as plain Node.
  const env = omit(process.env, ["ELECTRON_RUN_AS_NODE"]);
  electron = spawn(electronBinary, ["."], { stdio: "inherit", env });
}, 200);

// Dev needs inline React Refresh and the HMR socket, so the CSP only ships with builds.
// Inline styles are allowed because react-aria injects a <style> element and a static
// file:// build cannot mint per-load nonces; scripts stay restricted to the bundle.
const contentSecurityPolicy: Plugin = {
  name: "solyx:csp",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: {
        "http-equiv": "Content-Security-Policy",
        content: "default-src 'self'; style-src 'self' 'unsafe-inline'",
      },
      injectTo: "head-prepend",
    },
  ],
};

// The agent's scripts run in QuickJS, whose wasm ships beside the main bundle.
const quickjsWasm = createRequire(
  import.meta.resolve("@earendil-works/pi-codemode")
).resolve("quickjs-wasi/quickjs.wasm");

const nodeBundle: PackUserConfig = {
  platform: "node",
  // Workspace packages ship TS sources, so they are inlined; Electron is provided at runtime.
  deps: { neverBundle: ["electron"], alwaysBundle: [/^@solyx\//] },
  onSuccess: isDev ? restartElectron : undefined,
};

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy, ...uploadSourceMaps],
  server: {
    port: rendererUrl ? Number(new URL(rendererUrl).port) : undefined,
    strictPort: true,
  },
  // Tests cover main-process code under tests/, outside the renderer root.
  test: { root: import.meta.dirname },
  // Installers are never replayed from a cache, and tracking the files that 7-Zip and NSIS touch
  // stalls packaging on Windows.
  run: {
    tasks: {
      // The package workflow's Sentry DSN is written into the main bundle, and its token turns on
      // the renderer's source maps, so both reach the task.
      build: {
        command: ["vp build", "vp pack"],
        cache: {
          env: ["SENTRY_DSN", "SENTRY_AUTH_TOKEN"],
          untrackedEnv: ["SENTRY_ORG", "SENTRY_PROJECT"],
        },
      },
      package: {
        command:
          "electron-builder --config build/electron-builder.yml --publish never",
        dependsOn: ["build"],
        cache: false,
      },
      "package:nightly": {
        command:
          "electron-builder --config build/electron-builder.nightly.yml --publish never",
        dependsOn: ["build"],
        cache: false,
      },
    },
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    sourcemap: sentryAuthToken ? "hidden" : false,
  },
  pack: [
    {
      ...nodeBundle,
      entry: { index: "src/main/index.ts" },
      outDir: "dist/main",
      format: "esm",
      // Empty in development and forks, which then have nowhere to send crash reports.
      env: { SENTRY_DSN: process.env.SENTRY_DSN ?? "" },
      // drizzle's migrator reads SQL files at runtime, so they ship beside the bundle.
      copy: [
        {
          from: "../../packages/db/migrations/cache",
          to: "dist/main/migrations",
          rename: "cache",
        },
        {
          from: "../../packages/db/migrations/memory",
          to: "dist/main/migrations",
          rename: "memory",
        },
        {
          from: "../../packages/db/migrations/news",
          to: "dist/main/migrations",
          rename: "news",
        },
        {
          from: "../../packages/db/migrations/research",
          to: "dist/main/migrations",
          rename: "research",
        },
        {
          from: "../../packages/db/migrations/user",
          to: "dist/main/migrations",
          rename: "user",
        },
        { from: quickjsWasm, to: "dist/main" },
        { from: "resources/icon.png", to: "dist/main" },
        { from: "resources/trayTemplate.png", to: "dist/main" },
        { from: "resources/trayTemplate@2x.png", to: "dist/main" },
      ],
    },
    {
      ...nodeBundle,
      entry: { index: "src/preload/index.ts" },
      outDir: "dist/preload",
      // Sandboxed preloads cannot be ES modules.
      format: "cjs",
    },
    {
      ...nodeBundle,
      entry: { fubon: "src/utility/fubon.ts" },
      outDir: "dist/utility",
      format: "esm",
    },
    {
      ...nodeBundle,
      entry: { script: "src/worker/script.ts" },
      outDir: "dist/worker",
      format: "esm",
    },
  ],
});
