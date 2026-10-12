import { expect, test } from "vite-plus/test";

import { quoteChecker } from "../src/provenance.ts";

const READ = [
  [
    "TW 2330 fundamentals as filed, from finmind, as_of 2026-09-29; amounts in TWD millions",
    "quarter,revenue,revenue yoy",
    "2025-12-31,1100,+40.0%",
    "2026-03-31,1200,+50.0%",
    "2026-06-30,1350,+50.0%",
  ].join("\n"),
  "# 法說會摘要\n\n管理層表示，**先進製程**產能至 2027 年底前維持滿載，全年美元營收成長約 35%。",
  "Revenue fell −4.1% in the quarter, the company said.",
];

const unfound = quoteChecker(READ);

test("a quote copied from what was read is found, however it was spaced, punctuated or marked up", () => {
  expect(unfound("2026-06-30,1350,+50.0%")).toBeUndefined();
  // A page's emphasis marks, its spacing and full-width punctuation are how it was set.
  expect(
    unfound("管理層表示,先進製程產能至2027年底前維持滿載")
  ).toBeUndefined();
  expect(unfound("revenue fell -4.1% in the quarter")).toBeUndefined();
});

test("a table's rows are quoted a row to a line, each found on its own", () => {
  expect(
    unfound("2025-12-31,1100,+40.0%\n2026-06-30,1350,+50.0%")
  ).toBeUndefined();
  // Rows that do not follow each other, joined into one line, are the words of no row.
  expect(unfound("2025-12-31,1100,+40.0%; 2026-06-30,1350,+50.0%")).toBe(
    "2025-12-31,1100,+40.0%; 2026-06-30,1350,+50.0%"
  );
});

test("a quote that was altered or never read answers with its first line that is in nothing read", () => {
  // A figure changed, a point moved and a sign dropped each say something else.
  expect(unfound("2026-06-30,1380,+50.0%")).toBe("2026-06-30,1380,+50.0%");
  expect(unfound("全年美元營收成長約 3.5%")).toBe("全年美元營收成長約 3.5%");
  expect(unfound("Revenue fell 4.1% in the quarter")).toBe(
    "Revenue fell 4.1% in the quarter"
  );
  expect(unfound("2026-06-30,1350,+50.0%\nMargins widened to a record.")).toBe(
    "Margins widened to a record."
  );
});

test("a quote with no words to find is not found", () => {
  expect(unfound("…")).toBe("…");
  expect(quoteChecker([])("anything")).toBe("anything");
});
