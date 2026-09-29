import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { debounce } from "es-toolkit";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

const MAIN_BUNDLE = "dist/main/index.mjs";

const PRELOAD_BUNDLE = "dist/preload/index.cjs";

// Set by scripts/dev.mjs. Electron then loads the renderer from the dev server and
// restarts after every successful main/preload build.
const isDev = Boolean(process.env.SOLYX_RENDERER_URL);

let electron: ChildProcess | undefined;

// Main and preload build in parallel; debounce so one change restarts Electron once.
const restartElectron = debounce(() => {
  if (!existsSync(MAIN_BUNDLE) || !existsSync(PRELOAD_BUNDLE)) return;
  electron?.kill();
  // SAFETY: outside Electron, the `electron` package's entry exports the path to its binary.
  const electronBinary = createRequire(import.meta.url)("electron") as string;
  // Terminals hosted by Electron apps export this, which would boot Electron as plain Node.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
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

const nodeBundle: PackUserConfig = {
  platform: "node",
  // Workspace packages ship TS sources, so they are inlined; Electron is provided at runtime.
  deps: { neverBundle: ["electron"], alwaysBundle: [/^@solyx\//] },
  onSuccess: isDev ? restartElectron : undefined,
};

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy],
  server: { port: 5173, strictPort: true },
  // Tests cover main-process code under tests/, outside the renderer root.
  test: { root: import.meta.dirname },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
  pack: [
    {
      ...nodeBundle,
      entry: { index: "src/main/index.ts" },
      outDir: "dist/main",
      format: "esm",
    },
    {
      ...nodeBundle,
      entry: { index: "src/preload/index.ts" },
      outDir: "dist/preload",
      // Sandboxed preloads cannot be ES modules.
      format: "cjs",
    },
  ],
});
