import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "../../lib/source.ts";

// Fumadocs' default tokenizer segments every language, Chinese included, so no locale needs options.
const server = createFromSource(source);

// Prerendered into a file at build time; the browser downloads it and searches it locally.
export const Route = createFileRoute("/api/search")({
  server: { handlers: { GET: () => server.staticGET() } },
});
