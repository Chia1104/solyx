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
