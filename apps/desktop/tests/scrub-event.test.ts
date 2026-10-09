import { expect, test } from "vite-plus/test";

import { scrubEvent } from "../src/main/modules/crash-reports/scrub-event.ts";

const HOME = "/Users/someone";

test("a report keeps the error and where it happened, and drops what tells about the person", () => {
  const scrubbed = scrubEvent(
    {
      type: undefined,
      message: `Could not open ${HOME}/.solyx/config.json`,
      exception: {
        values: [
          {
            type: "Error",
            value: `ENOENT: ${HOME}/Library/Application Support/Solyx/news.sqlite`,
            stacktrace: {
              frames: [{ filename: "app:///dist/main/index.mjs" }],
            },
          },
        ],
      },
      request: { url: "file:///index.html#/symbol/TW/2330" },
      user: { ip_address: "203.0.113.7" },
      extra: { arguments: [{ symbol: "2330" }] },
      breadcrumbs: [
        { category: "electron", message: "app.ready" },
        { category: "console", message: "Embedding news failed" },
        { category: "ui.click", message: "button.buy" },
        { category: "navigation", data: { to: "#/symbol/TW/2330" } },
        { category: "child-process", message: "'Utility' process exited" },
      ],
    },
    HOME
  );

  expect(scrubbed.message).toBe("Could not open ~/.solyx/config.json");
  expect(scrubbed.exception?.values?.[0]).toEqual({
    type: "Error",
    value: "ENOENT: ~/Library/Application Support/Solyx/news.sqlite",
    stacktrace: { frames: [{ filename: "app:///dist/main/index.mjs" }] },
  });
  expect(scrubbed.request).toBeUndefined();
  expect(scrubbed.user).toBeUndefined();
  expect(scrubbed.extra).toBeUndefined();
  expect(scrubbed.breadcrumbs?.map(({ category }) => category)).toEqual([
    "electron",
    "child-process",
  ]);
});
