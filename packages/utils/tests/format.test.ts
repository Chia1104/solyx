import { expect, test } from "vite-plus/test";

import { cssPercent, formatBytes } from "../src/format.ts";

test.each([
  [400, "400 bytes"],
  [1, "1 byte"],
  [98_000, "98 kB"],
  [12_340_000, "12.3 MB"],
  [1_250_000_000, "1.3 GB"],
])("%d bytes read as %s in English", (bytes, shown) => {
  expect(formatBytes(bytes, "en-US")).toBe(shown);
});

test("a size reads in the locale's own way", () => {
  expect(formatBytes(3_100_000, "zh-TW")).toBe("3.1 MB");
});

test("a fraction of a box reads as a CSS percentage", () => {
  expect(cssPercent(0.25)).toBe("25%");
});
