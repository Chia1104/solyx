import { join } from "node:path";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";

// The release this build's reports belong to is the desktop app's, whose version the package
// workflow writes before it builds.
import desktop from "../desktop/package.json" with { type: "json" };

// Set by the desktop's scripts/dev.mjs, which picks the dev server's port with it.
const rendererUrl = process.env.SOLYX_RENDERER_URL;

// Set only by the package workflow, which uploads the source maps so Sentry can read minified
// stacks, and deletes them so they never ship.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

const uploadSourceMaps = sentryAuthToken
  ? sentryVitePlugin({
      authToken: sentryAuthToken,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      telemetry: false,
      // Named as the main process names its reports. Maps match by the debug ids injected into the
      // bundle, so the release is not injected.
      release: { name: `solyx@${desktop.version}`, inject: false },
      sourcemaps: {
        filesToDeleteAfterUpload: join(import.meta.dirname, "dist/**/*.map"),
      },
    })
  : [];

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

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy, ...uploadSourceMaps],
  server: {
    port: rendererUrl ? Number(new URL(rendererUrl).port) : undefined,
    strictPort: true,
  },
  // Tests sit under tests/, outside the app's root.
  test: { root: import.meta.dirname },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: sentryAuthToken ? "hidden" : false,
  },
  run: {
    tasks: {
      // The package workflow's token turns on the source maps, so it reaches the task.
      build: {
        command: "vp build",
        cache: {
          env: ["SENTRY_AUTH_TOKEN"],
          untrackedEnv: ["SENTRY_ORG", "SENTRY_PROJECT"],
        },
      },
    },
  },
});
