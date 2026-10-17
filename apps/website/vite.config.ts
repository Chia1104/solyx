import { glob } from "node:fs/promises";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { createGetUrl, getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";

const docsUrl = createGetUrl("/docs");

// The crawler only follows links, so every docs page is listed for the prerender as well.
const docsPages: { path: string }[] = [];

for await (const file of glob("**/*.mdx", {
  cwd: join(import.meta.dirname, "content/docs"),
})) {
  docsPages.push({ path: docsUrl(getSlugs(file)) });
}

export default defineConfig({
  // Fumadocs reads its content from the root, which the prerender's preview server does not pass on.
  root: import.meta.dirname,
  plugins: [
    fumadocsMdx(),
    // Tests run in Node; the plugin would move them into the Workers runtime, which they do not need.
    !process.env.VITEST && voidPlugin(),
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true, failOnError: true },
      pages: [{ path: "/api/search" }, ...docsPages],
    }),
    react(),
  ],
  environments: {
    // The Workers runtime bundles server dependencies ahead of time; found on the first request
    // instead, Fumadocs' MDX runtime reloads the server mid-render and splits React in two.
    ssr: { optimizeDeps: { include: ["fumadocs-mdx/runtime/macro"] } },
  },
  resolve: {
    // As Fumadocs' own Vite 8 examples do: tslib's ES module build, not its CommonJS entry.
    alias: { tslib: "tslib/tslib.es6.js" },
  },
  run: {
    tasks: {
      // The prerender runs on Miniflare, which keeps its local state under .void, and the Cloudflare
      // plugin points Wrangler at the build from .wrangler; neither is a source of the build.
      build: {
        command: "vp build",
        cache: {
          input: [{ auto: true }, "!.void/**", "!.wrangler/**"],
          output: [{ auto: true }, "!.void/**"],
        },
      },
      // Void builds the site itself before it uploads, and a deploy is never replayed from a cache.
      deploy: { command: "void deploy", cache: false },
    },
  },
});
