import { loader } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineCollections, defineDocs } from "fumadocs-mdx/macro";
import * as z from "zod";

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

/** A legal page's frontmatter: its title, its lede and the day it last changed. */
const legalPageSchema = pageSchema.extend({
  description: z.string(),
  updated: z.iso.date(),
});

/** The terms of use and the privacy policy, each locale's `name.<locale>.mdx` beside the English. */
export const legal = defineCollections({
  type: "doc",
  dir: "content/legal",
  async: true,
  schema: legalPageSchema,
});
