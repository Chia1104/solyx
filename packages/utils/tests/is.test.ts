import { describe, expect, test } from "vite-plus/test";

import { isEnumValue } from "../src/is.ts";

const Color = {
  Red: "red",
  Blue: "blue",
} as const;

describe("isEnumValue", () => {
  test("accepts a member value", () => {
    expect(isEnumValue(Color, "red")).toBe(true);
  });

  test("rejects keys, unknown values and non-strings", () => {
    expect(isEnumValue(Color, "Red")).toBe(false);
    expect(isEnumValue(Color, "green")).toBe(false);
    expect(isEnumValue(Color, 1)).toBe(false);
  });
});
