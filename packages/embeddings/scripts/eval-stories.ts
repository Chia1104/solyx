/**
 * Measures how alike the vectors of one story's items read against those of different stories,
 * and the line news grouping would need on that space: the lowest that joins no pair of different
 * stories, with the share of each kind of same-story pair it still joins. Run from the repository
 * root, against OpenAI or a model on this computer through Ollama:
 *
 *   node --env-file=.env packages/embeddings/scripts/eval-stories.ts
 *   EMBEDDINGS_DIMENSIONS=1536 node --env-file=.env packages/embeddings/scripts/eval-stories.ts
 *   EMBEDDINGS_PROVIDER=local node packages/embeddings/scripts/eval-stories.ts
 *
 * EMBEDDINGS_MODEL picks another of the provider's models; EMBEDDINGS_DIMENSIONS=native keeps its
 * vectors' own length.
 */
import { groupBy, uniq } from "es-toolkit";

import { cosine } from "@solyx/core/embedding";
import { storyText } from "@solyx/core/news";

import { embedderFromEnv } from "./env-embedder.ts";
import { STORY_PAIRS, isSameStory } from "./story-samples.ts";

const embedder = embedderFromEnv();

const texts = uniq(
  STORY_PAIRS.flatMap(({ a, b }) => [storyText(a), storyText(b)])
);

const started = performance.now();

const vectors = await embedder.embed(texts);

const seconds = (performance.now() - started) / 1000;

const vectorOf = new Map(texts.map((text, index) => [text, vectors[index]]));

const scored = STORY_PAIRS.map((pair) => ({
  ...pair,
  same: isSameStory(pair),
  similarity: cosine(
    vectorOf.get(storyText(pair.a)) ?? new Float32Array(),
    vectorOf.get(storyText(pair.b)) ?? new Float32Array()
  ),
})).toSorted((x, y) => y.similarity - x.similarity);

console.log(
  `${embedder.space}, ${texts.length} texts in ${seconds.toFixed(1)}s, ${vectors[0]?.length} numbers each\n`
);

for (const { a, b, kind, same, similarity } of scored) {
  console.log(
    `${similarity.toFixed(3)}  ${same ? "same" : "DIFF"}  ${kind.padEnd(16)} ${a.title.slice(0, 24)} | ${b.title.slice(0, 24)}`
  );
}

const apart = scored.filter((pair) => !pair.same);

const together = scored.filter((pair) => pair.same);

const nearest = Math.max(...apart.map((pair) => pair.similarity));

// The lowest line, in hundredths, that joins no pair of different stories.
const line = (Math.floor(nearest * 100) + 1) / 100;

console.log(
  `\nDifferent stories read at most ${nearest.toFixed(3)}, so the line is ${line.toFixed(2)}. Same stories joined at it:`
);

for (const [kind, pairs] of Object.entries(
  groupBy(together, (pair) => pair.kind)
)) {
  const joined = pairs.filter((pair) => pair.similarity >= line).length;

  console.log(`  ${kind}: ${joined}/${pairs.length}`);
}

const joined = together.filter((pair) => pair.similarity >= line).length;

console.log(`  all: ${joined}/${together.length}`);
