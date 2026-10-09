const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

// Scripts written without spaces between words.
const UNSPACED_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

// Words that may change case within, such as `getQuotes` or `CoWoS`.
const CASED_WORD = /[\p{Script=Latin}\p{N}]+/gu;

// A lone letter, such as a possessive's s or one a case change splits off, matches nearly anything.
const LONE_LETTER = /^\p{Script=Latin}$/u;

// Okapi BM25's usual parameters.
const K1 = 1.2;

const B = 0.75;

/** Overlapping pairs of a run's characters, or its one character. */
function pairs(run: string): string[] {
  const chars = [...run];

  return chars.length === 1
    ? chars
    : chars.slice(1).map((char, index) => `${chars[index]}${char}`);
}

/** A word whole, then split where its case changes, so `getQuotes` finds `quote` and `CoWoS` matches whole. */
function caseParts(word: string): string {
  const parts = word
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2");

  return parts === word ? word : `${word} ${parts}`;
}

/** Naive singular form, so `quotes` finds `quote` and `searches` finds `search`. */
function singular(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;

  if (term.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(term)) {
    return term.slice(0, -2);
  }

  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) {
    return term.slice(0, -1);
  }

  return term;
}

/**
 * The terms a search compares: words split at anything but letters and digits, each whole and
 * again where its case changes, lowercased, without stop words, lone letters or plurals, and runs
 * of Chinese, Japanese or Korean as overlapping pairs of characters. A full-text index fed these
 * terms matches as this module does.
 */
export function searchTerms(text: string): string[] {
  return text
    .replace(CASED_WORD, caseParts)
    .replace(UNSPACED_RUN, (run) => ` ${pairs(run).join(" ")} `)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (term) =>
        term.length > 0 && !STOP_WORDS.has(term) && !LONE_LETTER.test(term)
    )
    .map(singular);
}

/**
 * Ranks `items` for a query with Okapi BM25 over the text `fields` gives each, read once here.
 * The search returns the items matching any of the query's terms, best first, ties in their order.
 */
export function createSearchIndex<T>(
  items: readonly T[],
  fields: (item: T) => readonly (string | undefined)[]
): (query: string) => T[] {
  const documents = items.map((item) => {
    const counts = new Map<string, number>();
    const terms = searchTerms(fields(item).filter(Boolean).join(" "));

    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);

    return { item, counts, length: terms.length };
  });

  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) /
      documents.length || 1;

  return (query) => {
    const scores = documents.map(() => 0);

    for (const term of new Set(searchTerms(query))) {
      const holding = documents.filter((document) =>
        document.counts.has(term)
      ).length;

      const idf = Math.log(
        1 + (documents.length - holding + 0.5) / (holding + 0.5)
      );

      documents.forEach(({ counts, length }, index) => {
        const count = counts.get(term) ?? 0;
        const norm = K1 * (1 - B + (B * length) / averageLength);

        scores[index] += (idf * (count * (K1 + 1))) / (count + norm);
      });
    }

    return documents
      .map(({ item }, index) => ({ item, score: scores[index] ?? 0 }))
      .filter((match) => match.score > 0)
      .toSorted((a, b) => b.score - a.score)
      .map((match) => match.item);
  };
}
