import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "../../lib/source.ts";

const server = createFromSource(source, { language: "english" });

// Prerendered into a file at build time; the browser downloads it and searches it locally.
export const Route = createFileRoute("/api/search")({
  server: { handlers: { GET: () => server.staticGET() } },
});
