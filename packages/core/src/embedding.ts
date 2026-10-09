/**
 * Turns texts into vectors whose cosine tells how alike they read. One implementation per kind of
 * endpoint (`@solyx/embeddings/*`); it runs only in the main process.
 */
export interface Embedder {
  /**
   * The model and the length its vectors are cut to. Vectors of two spaces never compare, and a
   * line measured on one space holds for no other.
   */
  readonly space: string;
  /** One vector per text, in the order given. */
  embed(
    texts: readonly string[],
    options?: { signal?: AbortSignal }
  ): Promise<Float32Array[]>;
}

/** A text's vector and the space it lies in. */
export interface Embedding {
  space: string;
  values: Float32Array;
}

/** How alike two vectors of one space point, from -1 to 1; 0 when either is all zeros. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vectors of ${a.length} and ${b.length} do not compare`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

// How much nearer than the rest a hit reads: a query nothing answers still has a nearest item.
const STANDOUT = 0.12;

/**
 * Up to `limit` items that read clearly nearer a query than the rest do, nearest first. The line
 * follows each query's own mean, since how alike a query reads to everything varies by query and
 * by space.
 */
export function clearlyNearest<T>(
  scored: readonly { item: T; similarity: number }[],
  limit: number
): T[] {
  if (scored.length === 0) return [];

  const mean =
    scored.reduce((sum, { similarity }) => sum + similarity, 0) / scored.length;

  return scored
    .filter(({ similarity }) => similarity >= mean + STANDOUT)
    .toSorted((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ item }) => item);
}
