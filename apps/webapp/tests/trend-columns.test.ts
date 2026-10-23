import { expect, test } from "vite-plus/test";

import {
  columnScale,
  quarterOf,
} from "../src/modules/fundamentals/trend-columns.ts";

test("columns that all rise stand on zero at the plot's floor", () => {
  expect(columnScale([50, 100, 25])).toEqual({
    zero: 1,
    columns: [
      { top: 0.5, height: 0.5, falls: false },
      { top: 0, height: 1, falls: false },
      { top: 0.75, height: 0.25, falls: false },
    ],
  });
});

test("a figure below zero hangs from it, on a scale that holds both sides", () => {
  expect(columnScale([30, -10])).toEqual({
    zero: 0.75,
    columns: [
      { top: 0, height: 0.75, falls: false },
      { top: 0.75, height: 0.25, falls: true },
    ],
  });
});

test("columns that all fall hang from zero at the plot's top", () => {
  expect(columnScale([-20, -40])).toEqual({
    zero: 0,
    columns: [
      { top: 0, height: 0.5, falls: true },
      { top: 0, height: 1, falls: true },
    ],
  });
});

test("a missing figure leaves a gap, and figures that are all zero draw nothing", () => {
  expect(columnScale([null, 10]).columns).toEqual([
    null,
    { top: 0, height: 1, falls: false },
  ]);
  expect(columnScale([0, null])).toEqual({
    zero: 1,
    columns: [{ top: 1, height: 0, falls: false }, null],
  });
  expect(columnScale([])).toEqual({ zero: 1, columns: [] });
});

test("a statement's last day names its calendar quarter", () => {
  expect(quarterOf("2026-03-31")).toEqual({ year: 2026, quarter: 1 });
  expect(quarterOf("2026-06-30")).toEqual({ year: 2026, quarter: 2 });
  expect(quarterOf("2025-12-31")).toEqual({ year: 2025, quarter: 4 });
});
