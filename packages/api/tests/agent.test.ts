import { expect, test } from "vite-plus/test";

import { PREVIEW_CHARACTERS, previewText } from "../src/agent.ts";

test("a preview shows a long file's first part and how long it is", () => {
  const text = "a".repeat(PREVIEW_CHARACTERS + 5);

  expect(previewText(text)).toEqual({
    text: text.slice(0, PREVIEW_CHARACTERS),
    characters: PREVIEW_CHARACTERS + 5,
  });
  expect(previewText("a,b")).toEqual({ text: "a,b", characters: 3 });
});
