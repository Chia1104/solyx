import { glob, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { createElement } from "react";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { createGetUrl, getSlugs } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { generateOGImage } from "fumadocs-ui/og/takumi";
import { Renderer } from "takumi-js/node";
import type { Plugin } from "vite-plus";
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";

import websiteEnUS from "@solyx/i18n/website/en-US.json";
import websiteZhTW from "@solyx/i18n/website/zh-TW.json";

import { latestReleases, readReleases } from "./src/lib/releases.ts";
import { socialCardPath } from "./src/lib/social-card.ts";

const docsUrl = createGetUrl("/docs");

const docsDir = join(import.meta.dirname, "content/docs");

// The crawler only follows links, and the language switcher is a button, so every page in every
// locale is listed for the prerender as well. A translated page is `name.<locale>.mdx`, whose URL
// takes the locale's prefix; English takes none.
const pages = [
  { path: "/api/search" },
  { path: "/zh-TW" },
  { path: "/download" },
  { path: "/zh-TW/download" },
];

// The landing page's card carries the hero's two lines, since the site's name is already its footer.
const cards: { path: string; title: string; description?: string }[] = [
  { prefix: "", copy: websiteEnUS },
  { prefix: "/zh-TW", copy: websiteZhTW },
].flatMap(({ prefix, copy }) => [
  { path: prefix || "/", title: copy.hero.pencil, description: copy.hero.ink },
  {
    path: `${prefix}/download`,
    title: copy.download.title,
    description: copy.download.lede,
  },
]);

for await (const file of glob("**/*.mdx", { cwd: docsDir })) {
  const [, name, locale] =
    /^(.+?)(?:\.([a-z]{2}-[A-Z]{2}))?\.mdx$/.exec(file) ?? [];

  const url = docsUrl(getSlugs(`${name}.mdx`));
  const path = locale ? `/${locale}${url}` : url;

  const { title, description } = pageSchema.parse(
    frontmatter(await readFile(join(docsDir, file), "utf8")).data
  );

  pages.push({ path });
  cards.push({ path, title, description });
}

const LATEST_RELEASES = "virtual:latest-releases";

let releases: ReturnType<typeof readReleases> | undefined;

// GitHub's releases are read once per build, so the pages prerender with them and the browser never
// asks GitHub; publishing a release redeploys the site.
const releaseData = {
  name: "solyx:releases",
  resolveId: (id) =>
    id === LATEST_RELEASES ? `\0${LATEST_RELEASES}` : undefined,
  async load(id) {
    if (id !== `\0${LATEST_RELEASES}`) return undefined;

    releases ??= readReleases(process.env.GITHUB_TOKEN);

    return `export default ${JSON.stringify(latestReleases(await releases))};`;
  },
} satisfies Plugin;

const require = createRequire(import.meta.url);

// TanStack Start's prerender writes a response as text, which breaks an image, and a card drawn in
// the Worker would run past Workers Free's CPU time, so the client build draws every card in Node,
// into files Cloudflare serves.
const socialCards = {
  name: "solyx:social-cards",
  apply: "build",
  applyToEnvironment: (environment) => environment.name === "client",
  async generateBundle() {
    const renderer = new Renderer();

    // Fontsource splits a family into files by script; the renderer joins those of one name.
    for (const [name, pkg] of [
      ["Archivo", "@fontsource-variable/archivo"],
      ["Noto Sans TC", "@fontsource-variable/noto-sans-tc"],
    ]) {
      const files = join(dirname(require.resolve(pkg)), "files");

      for (const file of await readdir(files)) {
        if (file.endsWith("-wght-normal.woff2")) {
          await renderer.registerFont({
            name,
            data: await readFile(join(files, file)),
          });
        }
      }
    }

    const icon = createElement("img", {
      src: `data:image/png;base64,${(await readFile(join(import.meta.dirname, "public/icon.png"))).toString("base64")}`,
      width: 56,
      height: 56,
    });

    for (const card of cards) {
      const image = generateOGImage({
        ...card,
        site: "Solyx",
        icon,
        renderer,
        primaryColor: "rgba(128, 151, 255, 0.35)",
        primaryTextColor: "#8097ff",
        css: "div { font-family: Archivo, 'Noto Sans TC'; }",
      });

      this.emitFile({
        type: "asset",
        fileName: socialCardPath(card.path).slice(1),
        source: new Uint8Array(await image.arrayBuffer()),
      });
    }
  },
} satisfies Plugin;

export default defineConfig({
  // Fumadocs reads its content from the root, which the prerender's preview server does not pass on.
  root: import.meta.dirname,
  plugins: [
    fumadocsMdx(),
    // Tests run in Node; the plugin would move them into the Workers runtime, which they do not need.
    !process.env.VITEST && voidPlugin(),
    // Void refuses a Worker that carries an image, and every page's assets reach the client build
    // anyway, since each is prerendered and hydrated. The Cloudflare plugin turns emitting on for the
    // Worker, and only a hook after it turns that off.
    {
      name: "solyx:server-emits-no-assets",
      configEnvironment: (name) =>
        name === "ssr" ? { build: { emitAssets: false } } : undefined,
    },
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true, failOnError: true },
      pages,
    }),
    react(),
    releaseData,
    socialCards,
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
      // The prerender runs on Miniflare, which keeps its local state under .void and caches request
      // metadata under node_modules/.mf, and the Cloudflare plugin points Wrangler at the build from
      // .wrangler; none is a source of the build.
      build: {
        command: "vp build",
        cache: {
          input: [
            { auto: true },
            "!.void/**",
            "!.wrangler/**",
            "!node_modules/.mf/**",
          ],
          output: [{ auto: true }, "!.void/**", "!node_modules/.mf/**"],
        },
      },
      // Void builds the site itself before it uploads, and a deploy is never replayed from a cache.
      // A fresh checkout, as in CI, has no saved target, so the platform is named.
      deploy: { command: "void deploy --platform cloudflare", cache: false },
    },
  },
});
