import { uniq } from "es-toolkit";

import { searchTerms } from "@solyx/utils/search";

/** What a full-text index holds of a row: the terms of its texts, as `searchTerms` gives them. */
export function indexedTerms(
  texts: readonly (string | null | undefined)[]
): string {
  return searchTerms(texts.filter(Boolean).join(" ")).join(" ");
}

/** The FTS5 query matching a row that holds any of `query`'s terms; `null` when it has none. */
export function anyTerm(query: string): string | null {
  const terms = uniq(searchTerms(query));

  // Terms hold only letters and digits, so quoting each makes it a plain word to FTS5.
  return terms.length === 0
    ? null
    : terms.map((term) => `"${term}"`).join(" OR ");
}
