import { expect, test } from "vite-plus/test";

import {
  ComposerTokenKind,
  replaceToken,
  tokenAt,
} from "../src/renderer/modules/agent/composer-token.ts";

test("@ asks for a listing where no letter or digit precedes it, and its query may be a name", () => {
  expect(tokenAt("比較@23", 5)).toEqual({
    kind: ComposerTokenKind.Listing,
    start: 2,
    end: 5,
    query: "23",
  });
  expect(tokenAt("看 ＠台積", 5)).toMatchObject({ start: 2, query: "台積" });
  expect(tokenAt("me@x", 4)).toBeNull();
});

test("/ asks for a skill only where it opens the message", () => {
  expect(tokenAt(" /deep", 6)).toEqual({
    kind: ComposerTokenKind.Skill,
    start: 1,
    end: 6,
    query: "deep",
  });
  expect(tokenAt("a /deep", 7)).toBeNull();
});

test("a token runs past the caret to the next space, and what replaces it ends in one", () => {
  const token = tokenAt("@23xx 和", 3);

  expect(token).toMatchObject({ start: 0, end: 5, query: "23" });
  expect(replaceToken("@23xx 和", token!, "@2330")).toEqual({
    text: "@2330 和",
    caret: 6,
  });
});
