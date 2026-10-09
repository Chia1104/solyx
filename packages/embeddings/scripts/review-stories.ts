/**
 * Lists the pairs of collected news that news grouping lets a space's vectors compare, most alike
 * first, for a person to read which tell one story: a line belongs above the first pair that does
 * not. Run from the repository root on a copy of the app's news.sqlite, naming its listings:
 *
 *   EMBEDDINGS_PROVIDER=local node packages/embeddings/scripts/review-stories.ts /tmp/news.sqlite TW:2330 TW:2317
 *
 * The copy is migrated as the app would open it. Its items' titles and snippets go to the provider,
 * so they leave this computer unless it is local. REVIEW_FLOOR, 0.7 unless set, hides pairs below it.
 */
import { fileURLToPath } from "node:url";

import { uniq } from "es-toolkit";

import { cosine } from "@solyx/core/embedding";
import { Market } from "@solyx/core/market";
import { STORY_LINES, comparableByVector, storyText } from "@solyx/core/news";
import { openNews } from "@solyx/db/news";
import { isEnumValue } from "@solyx/utils/is";

import { embedderFromEnv } from "./env-embedder.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../../db/migrations/news", import.meta.url)
);

const [file, ...named] = process.argv.slice(2);

if (!file || named.length === 0) {
  throw new Error(
    "Name a copy of news.sqlite and its listings, such as TW:2330"
  );
}

const listings = named.map((each) => {
  const [market = "", symbol = ""] = each.split(":");

  if (!isEnumValue(Market, market) || !symbol) {
    throw new Error(`A listing reads as TW:2330, not ${each}`);
  }

  return { market, symbol };
});

const floor = Number(process.env.REVIEW_FLOOR ?? 0.7);

const embedder = embedderFromEnv();

const news = openNews(file, MIGRATIONS);

const recordsOf = listings.map((symbol) =>
  news.store.list(symbol, new Date(0))
);

news.close();

const texts = uniq(recordsOf.flat().map(({ item }) => storyText(item)));

const vectors = await embedder.embed(texts);

const vectorOf = new Map(texts.map((text, index) => [text, vectors[index]]));

const pairs = listings.flatMap((symbol, at) => {
  const records = recordsOf[at];

  return records.flatMap((a, index) =>
    records.slice(index + 1).flatMap((b) => {
      if (!comparableByVector(a, b, symbol.market)) return [];

      const similarity = cosine(
        vectorOf.get(storyText(a.item)) ?? new Float32Array(),
        vectorOf.get(storyText(b.item)) ?? new Float32Array()
      );

      return similarity >= floor
        ? [{ similarity, symbol: symbol.symbol, a: a.item, b: b.item }]
        : [];
    })
  );
});

const line = STORY_LINES.get(embedder.space);

console.log(
  `${embedder.space}: line ${line ?? "not measured"}, ${pairs.length} pairs at ${floor} or above\n`
);

for (const { similarity, symbol, a, b } of pairs.toSorted(
  (x, y) => y.similarity - x.similarity
)) {
  const joined = line !== undefined && similarity >= line ? "JOINED" : "      ";

  console.log(
    `${similarity.toFixed(3)} ${joined} ${symbol} ${a.site} | ${b.site}\n    ${a.title}\n    ${b.title}`
  );
}
