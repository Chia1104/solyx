// What a quote must share with its source: letters, digits, a percent sign, the point inside a
// number and the minus before one. Spacing, punctuation and a page's markup are how it was set,
// not what it says.
const KEPT = /[\p{L}\p{N}%]|(?<=\d)\.(?=\d)|-(?=\d)/gu;

/** A text as it is compared: the same however it was spaced, cased, punctuated or marked up. */
const essence = (text: string) =>
  (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[−–—]/g, "-")
      .match(KEPT) ?? []
  ).join("");

/**
 * Tells whether a quote is the words of something read: each of its lines must stand, whole, in
 * one of `texts`, so a table's rows are quoted a row to a line and a quote rebuilt from memory or
 * altered on the way is not found. It answers with the first line that is in none of them, or
 * `undefined` when every line is.
 */
export function quoteChecker(
  texts: readonly string[]
): (quote: string) => string | undefined {
  const read = texts.map(essence);

  return (quote) => {
    const lines = quote
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => essence(line) !== "");

    // A quote of nothing but marks has no words to find.
    if (lines.length === 0) return quote;

    return lines.find(
      (line) => !read.some((text) => text.includes(essence(line)))
    );
  };
}
