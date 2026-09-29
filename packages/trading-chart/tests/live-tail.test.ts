import { describe, expect, test } from "vite-plus/test";

import { liveTail } from "../src/live-tail.ts";
import { utcTimestamp } from "../src/time-format.ts";

const at = (time: number, value: number) => ({
  time: utcTimestamp(time),
  value,
});

const bars = [at(1, 10), at(2, 11)];

describe("liveTail", () => {
  test("an updated last bar is the whole tail", () => {
    expect(liveTail(bars, [bars[0], at(2, 12)])).toEqual([at(2, 12)]);
  });

  test("a new bar comes after the last bar's final state", () => {
    expect(liveTail(bars, [bars[0], at(2, 12), at(3, 13)])).toEqual([
      at(2, 12),
      at(3, 13),
    ]);
  });

  test.each([
    { name: "an earlier bar changed", next: [at(1, 9), bars[1]] },
    { name: "the last bar moved", next: [bars[0], at(3, 11)] },
    { name: "a bar was removed", next: [bars[0]] },
    {
      name: "two bars were added",
      next: [...bars, at(3, 0), at(4, 0)],
    },
  ])("needs a full reset when $name", ({ next }) => {
    expect(liveTail(bars, next)).toBeUndefined();
  });

  test("an empty series needs a full reset", () => {
    expect(liveTail([], bars)).toBeUndefined();
  });
});
