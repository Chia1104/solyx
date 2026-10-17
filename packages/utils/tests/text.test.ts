import { expect, test } from "vite-plus/test";

import {
  counted,
  firstLine,
  normalizeSpace,
  tildify,
  truncate,
} from "../src/text.ts";

test("whitespace runs become one space, with none at either end", () => {
  expect(normalizeSpace("  TSMC\n\traises   its outlook ")).toBe(
    "TSMC raises its outlook"
  );
});

test("text longer than the limit is cut there with an ellipsis, and shorter text is kept whole", () => {
  expect(truncate("abcdef", 3)).toBe("abc…");
  expect(truncate("abc", 3)).toBe("abc");
});

test("the first line is cut like any text", () => {
  expect(firstLine("\n  Quarterly results\nmore", 9)).toBe("Quarterly…");
  expect(firstLine("", 9)).toBe("");
});

test.each([
  ["/Users/a/.solyx/config.json", "~/.solyx/config.json"],
  ["/Users/a", "~"],
  [
    "node /Users/a/mcp/server.js --root /Users/a",
    "node ~/mcp/server.js --root ~",
  ],
  ["/Users/ab/config.json", "/Users/ab/config.json"],
])("%s reads as %s under the home folder /Users/a", (text, shown) => {
  expect(tildify(text, "/Users/a")).toBe(shown);
});

test("a Windows home folder is written ~ too", () => {
  expect(tildify("C:\\Users\\a\\.solyx", "C:\\Users\\a")).toBe("~\\.solyx");
});

test("a count takes its noun's plural unless it is one", () => {
  expect(counted(1, "session")).toBe("1 session");
  expect(counted(3, "session")).toBe("3 sessions");
  expect(counted(2, "memory", "memories")).toBe("2 memories");
});
