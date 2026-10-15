import { glob } from "node:fs/promises";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { createGetUrl, getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";

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
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true, failOnError: true },
      pages: [{ path: "/api/search" }, ...docsPages],
    }),
    react(),
  ],
  resolve: {
    // As Fumadocs' own Vite 8 examples do: tslib's ES module build, not its CommonJS entry.
    alias: { tslib: "tslib/tslib.es6.js" },
  },
});
