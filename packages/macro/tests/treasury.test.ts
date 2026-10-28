import { expect, test, vi } from "vite-plus/test";

import { createTreasury } from "../src/treasury.ts";

const HEADER =
  'Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"';

/** A year's file as the Treasury writes it, newest day first. */
const FILES = new Map([
  [
    "2025",
    [
      HEADER,
      "12/31/2025,3.60,3.61,3.62,3.63,,3.55,3.50,3.45,3.50,3.60,3.80,4.15,4.70,4.80",
    ].join("\n"),
  ],
  [
    "2026",
    [
      HEADER,
      "10/28/2026,4.07,4.10,4.16,4.18,4.22,4.32,4.47,4.67,4.80,4.85,4.95,5.05,5.41,5.37",
      "10/27/2026,4.10,4.11,4.18,4.22,4.31,4.34,4.50,4.70,4.80,4.82,4.91,4.99,5.34,",
      "not a day",
    ].join("\n"),
  ],
]);

function setup(files = FILES) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(new Request(input).url);

    return new Response(
      files.get(url.searchParams.get("field_tdr_date_value") ?? "") ?? HEADER
    );
  });

  return {
    fetch,
    treasury: createTreasury({
      fetch,
      now: () => new Date("2026-10-29T12:00:00Z"),
    }),
  };
}

test("reads each year's file from the one `since` falls in, oldest day first, a tenor not priced as empty", async () => {
  const { fetch, treasury } = setup();

  await expect(treasury.curves("2025-12-01")).resolves.toEqual([
    {
      date: "2025-12-31",
      yields: { "3m": 3.63, "2y": 3.45, "10y": 4.15, "30y": 4.8 },
    },
    {
      date: "2026-10-27",
      yields: { "3m": 4.22, "2y": 4.7, "10y": 4.99, "30y": null },
    },
    {
      date: "2026-10-28",
      yields: { "3m": 4.18, "2y": 4.67, "10y": 5.05, "30y": 5.37 },
    },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a file without a followed tenor's column fails rather than reading another as it", async () => {
  const { treasury } = setup(
    new Map([["2026", 'Date,"3 Mo","2 Yr","10 Yr"\n10/28/2026,4.18,4.67,5.05']])
  );

  await expect(treasury.curves("2026-10-01")).rejects.toThrow(
    "The Treasury's yield curve of 2026 no longer has 30 Yr"
  );
});
