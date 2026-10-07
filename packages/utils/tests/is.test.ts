import { describe, expect, test } from "vite-plus/test";

import { isEnumValue, isTimeZone } from "../src/is.ts";

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

describe("isTimeZone", () => {
  test("accepts IANA names and UTC", () => {
    expect(isTimeZone("Asia/Taipei")).toBe(true);
    expect(isTimeZone("America/New_York")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
  });

  test("rejects unknown names, offsets written as text and the empty string", () => {
    expect(isTimeZone("Asia/Taipei2")).toBe(false);
    expect(isTimeZone("GMT+8")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});
