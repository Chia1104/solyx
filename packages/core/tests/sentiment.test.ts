import { expect, test } from "vite-plus/test";

import { Stance, stanceValue } from "../src/sentiment.ts";

test("the stance weighs each level by its probability", () => {
  expect(
    stanceValue({
      [Stance.Negative]: 0,
      [Stance.LeanNegative]: 0,
      [Stance.Neutral]: 0.2,
      [Stance.LeanPositive]: 0.4,
      [Stance.Positive]: 0.4,
    })
  ).toBeCloseTo(0.6);

  expect(
    stanceValue({
      [Stance.Negative]: 1,
      [Stance.LeanNegative]: 0,
      [Stance.Neutral]: 0,
      [Stance.LeanPositive]: 0,
      [Stance.Positive]: 0,
    })
  ).toBe(-1);
});
