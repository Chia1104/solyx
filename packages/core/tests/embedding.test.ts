import { expect, test } from "vite-plus/test";

import { clearlyNearest, cosine } from "../src/embedding.ts";

test("cosine reads the angle between vectors, whatever their lengths", () => {
  expect(cosine(Float32Array.of(1, 0), Float32Array.of(3, 0))).toBe(1);
  expect(cosine(Float32Array.of(1, 0), Float32Array.of(0, 2))).toBe(0);
  expect(cosine(Float32Array.of(1, 1), Float32Array.of(-1, -1))).toBeCloseTo(
    -1
  );
  expect(cosine(Float32Array.of(0, 0), Float32Array.of(1, 0))).toBe(0);
  expect(() => cosine(Float32Array.of(1), Float32Array.of(1, 0))).toThrow();
});

test("only items reading clearly nearer than the rest are near, nearest first", () => {
  const scored = (similarities: number[]) =>
    similarities.map((similarity, item) => ({ item, similarity }));

  expect(clearlyNearest(scored([0.3, 0.7, 0.3, 0.6, 0.3]), 5)).toEqual([1, 3]);
  expect(clearlyNearest(scored([0.3, 0.7, 0.3, 0.6, 0.3]), 1)).toEqual([1]);
  // Nothing stands out when everything reads alike.
  expect(clearlyNearest(scored([0.5, 0.48, 0.47]), 5)).toEqual([]);
  expect(clearlyNearest([], 5)).toEqual([]);
});
