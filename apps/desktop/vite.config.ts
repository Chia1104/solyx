import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { debounce, omit } from "es-toolkit";
import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

const MAIN_BUNDLE = "dist/main/index.mjs";

const PRELOAD_BUNDLE = "dist/preload/index.cjs";

const BACKEND_BUNDLE = "dist/utility/backend.mjs";

// Set by scripts/dev.mjs, which serves `@solyx/webapp` on it. Electron then loads the renderer from
// the dev server and restarts after every successful main, preload and backend build.
const rendererUrl = process.env.SOLYX_RENDERER_URL;

const isDev = Boolean(rendererUrl);

let electron: ChildProcess | undefined;

// Main and preload build in parallel; debounce so one change restarts Electron once.
const restartElectron = debounce(() => {
  if (
    ![MAIN_BUNDLE, PRELOAD_BUNDLE, BACKEND_BUNDLE].every((bundle) =>
      existsSync(bundle)
    )
  )
    return;
  electron?.kill();
  // SAFETY: outside Electron, the `electron` package's entry exports the path to its binary.
  const electronBinary = createRequire(import.meta.url)("electron") as string;
  // Terminals hosted by Electron apps export this, which would boot Electron as plain Node.
  const env = omit(process.env, ["ELECTRON_RUN_AS_NODE"]);
  electron = spawn(electronBinary, ["."], { stdio: "inherit", env });
}, 200);

// The agent's scripts run in QuickJS, whose wasm ships beside the main bundle.
const quickjsWasm = createRequire(
  import.meta.resolve("@earendil-works/pi-codemode")
).resolve("quickjs-wasi/quickjs.wasm");

// The kernel's process loads its native build from beside its bundle.
const kernelBuild = fileURLToPath(
  new URL("solyx-kernel.node", import.meta.resolve("@solyx/kernel/kernel"))
);

const nodeBundle: PackUserConfig = {
  platform: "node",
  // Workspace packages ship TS sources, so they are inlined; Electron is provided at runtime.
  deps: { neverBundle: ["electron"], alwaysBundle: [/^@solyx\//] },
  onSuccess: isDev ? restartElectron : undefined,
};

export default defineConfig({
  // Installers are never replayed from a cache, and tracking the files that 7-Zip and NSIS touch
  // stalls packaging on Windows.
  run: {
    tasks: {
      // The package workflow's Sentry DSN is written into the main bundle, so it reaches the task.
      // The kernel's build ships beside the backend's bundle, so it is built first.
      dev: {
        command: "node scripts/dev.mjs",
        dependsOn: ["@solyx/kernel#build"],
        cache: false,
      },
      build: {
        command: "vp pack",
        dependsOn: ["@solyx/webapp#build", "@solyx/kernel#build"],
        cache: { env: ["SENTRY_DSN"] },
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
      // Unpacked, since it only runs on the computer it was built on.
      "package:test": {
        command:
          "electron-builder --config build/electron-builder.test.yml --publish never --dir",
        dependsOn: ["build"],
        cache: false,
      },
    },
  },
  pack: [
    {
      ...nodeBundle,
      entry: { index: "src/main/index.ts" },
      outDir: "dist/main",
      format: "esm",
      // Empty in development and forks, which then have nowhere to send crash reports.
      env: { SENTRY_DSN: process.env.SENTRY_DSN ?? "" },
      // The tray and the windows read their icons beside the bundle, and a window loads the renderer
      // from `dist/renderer`, which development serves instead.
      copy: [
        { from: "resources/icon.png", to: "dist/main" },
        { from: "resources/trayTemplate.png", to: "dist/main" },
        { from: "resources/trayTemplate@2x.png", to: "dist/main" },
        ...(isDev
          ? []
          : [{ from: "../webapp/dist", to: "dist", rename: "renderer" }]),
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
      entry: {
        backend: "src/utility/backend.ts",
        fubon: "src/utility/fubon.ts",
        kernel: "src/utility/kernel.ts",
      },
      outDir: "dist/utility",
      format: "esm",
      // drizzle's migrator reads SQL files, the agent's scripts QuickJS's wasm and the kernel's
      // process its native build at runtime, so they ship beside the bundles.
      copy: [
        {
          from: "../../packages/db/migrations/cache",
          to: "dist/utility/migrations",
          rename: "cache",
        },
        {
          from: "../../packages/db/migrations/memory",
          to: "dist/utility/migrations",
          rename: "memory",
        },
        {
          from: "../../packages/db/migrations/news",
          to: "dist/utility/migrations",
          rename: "news",
        },
        {
          from: "../../packages/db/migrations/research",
          to: "dist/utility/migrations",
          rename: "research",
        },
        {
          from: "../../packages/db/migrations/user",
          to: "dist/utility/migrations",
          rename: "user",
        },
        { from: quickjsWasm, to: "dist/utility" },
        { from: kernelBuild, to: "dist/utility" },
      ],
    },
    {
      ...nodeBundle,
      entry: {
        script: fileURLToPath(
          import.meta.resolve("@solyx/backend/worker/script")
        ),
        backup: fileURLToPath(
          import.meta.resolve("@solyx/backend/worker/backup")
        ),
      },
      outDir: "dist/worker",
      format: "esm",
    },
  ],
});
