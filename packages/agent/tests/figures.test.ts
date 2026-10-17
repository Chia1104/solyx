import { expect, test } from "vite-plus/test";

import {
  bandText,
  figure,
  percent,
  percentChange,
  signed,
  signedFigure,
} from "../src/figures.ts";

test("a figure drops the digits arithmetic leaves, and a missing one reads n/a", () => {
  expect(figure(0.1 + 0.2)).toBe("0.3");
  expect(figure(1234.56789, 4)).toBe("1234.5679");
  expect(figure(null)).toBe("n/a");
});

test("a change carries a plus above zero and none at zero", () => {
  expect(signed(0.6)).toBe("+0.60");
  expect(signed(0)).toBe("0.00");
  expect(signed(-1.5, 1)).toBe("-1.5");
  expect(signedFigure(12.5)).toBe("+12.5");
});

test("a fraction reads in percent, as a change or as a part", () => {
  expect(percentChange(0.0123)).toBe("+1.23%");
  expect(percentChange(-0.05, 1)).toBe("-5.0%");
  expect(percentChange(null)).toBe("n/a");
  expect(percent(0.256)).toBe("25.6%");
  expect(percent(0.256, 0)).toBe("26%");
});

test("a band open on one side says so", () => {
  expect(bandText(null, 100)).toBe("below 100");
  expect(bandText(100, 120)).toBe("100 to 120");
  expect(bandText(120, null)).toBe("120 and above");
});
