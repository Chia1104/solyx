import { defineConfig } from "void/config";

export default defineConfig({
  worker: { compatibility_date: "2026-02-24" },
  cloudflare: {
    // The router's URLs have no trailing slash, so each page's prerendered index.html answers its own URL.
    assets: { html_handling: "drop-trailing-slash" },
  },
});
