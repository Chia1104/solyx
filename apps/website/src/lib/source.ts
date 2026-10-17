import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { i18n } from "./i18n.ts";

export const docs = defineDocs({
  dir: "content/docs",
  docs: { async: true },
});

// A page translated into a locale is `name.<locale>.mdx` beside its English `name.mdx`.
export const source = loader({
  i18n,
  source: docs.toFumadocsSource(),
  baseUrl: "/docs",
});
