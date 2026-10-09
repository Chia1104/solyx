/**
 * Measures how alike a memory and one that only says it again read against memories of one kind
 * and listing that hold different things, and the lowest line that flags no pair of different
 * memories. Run from the repository root, as `eval-stories.ts` runs:
 *
 *   EMBEDDINGS_PROVIDER=local node packages/embeddings/scripts/eval-memories.ts
 */
import { uniq } from "es-toolkit";

import { cosine } from "@solyx/core/embedding";
import { memoryText } from "@solyx/core/memory";

import { embedderFromEnv } from "./env-embedder.ts";
import { MEMORY_PAIRS } from "./memory-samples.ts";

const embedder = embedderFromEnv();

const textOf = (description: string) => memoryText({ description, body: "" });

const texts = uniq(MEMORY_PAIRS.flatMap(({ a, b }) => [textOf(a), textOf(b)]));

const vectors = await embedder.embed(texts);

const vectorOf = new Map(texts.map((text, index) => [text, vectors[index]]));

const scored = MEMORY_PAIRS.map((pair) => ({
  ...pair,
  similarity: cosine(
    vectorOf.get(textOf(pair.a)) ?? new Float32Array(),
    vectorOf.get(textOf(pair.b)) ?? new Float32Array()
  ),
})).toSorted((x, y) => y.similarity - x.similarity);

console.log(`${embedder.space}, ${texts.length} texts\n`);

for (const { a, b, same, similarity } of scored) {
  console.log(
    `${similarity.toFixed(3)}  ${same ? "same" : "DIFF"}  ${a.slice(0, 24)} | ${b.slice(0, 24)}`
  );
}

const nearest = Math.max(
  ...scored.filter((pair) => !pair.same).map((pair) => pair.similarity)
);

// The lowest line, in hundredths, that flags no pair of different memories.
const line = (Math.floor(nearest * 100) + 1) / 100;

const repeats = scored.filter((pair) => pair.same);

const flagged = repeats.filter((pair) => pair.similarity >= line).length;

console.log(
  `\nDifferent memories read at most ${nearest.toFixed(3)}, so the line is ${line.toFixed(2)}; it flags ${flagged}/${repeats.length} repeats.`
);
