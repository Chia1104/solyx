import { expect, test } from "vite-plus/test";

import { cosine } from "../src/embedding.ts";

test("cosine reads the angle between vectors, whatever their lengths", () => {
  expect(cosine(Float32Array.of(1, 0), Float32Array.of(3, 0))).toBe(1);
  expect(cosine(Float32Array.of(1, 0), Float32Array.of(0, 2))).toBe(0);
  expect(cosine(Float32Array.of(1, 1), Float32Array.of(-1, -1))).toBeCloseTo(
    -1
  );
  expect(cosine(Float32Array.of(0, 0), Float32Array.of(1, 0))).toBe(0);
  expect(() => cosine(Float32Array.of(1), Float32Array.of(1, 0))).toThrow();
});
