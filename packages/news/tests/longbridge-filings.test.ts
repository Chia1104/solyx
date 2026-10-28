import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import { createLongbridgeApi } from "@solyx/market-data/longbridge-api";

import { createLongbridgeFilings } from "../src/longbridge-filings.ts";

const APPLE = { symbol: { market: Market.US, symbol: "AAPL" }, listing: null };

const TOKEN = "hk_access";

const seconds = (at: string) => String(Date.parse(at) / 1000);

/** A filing as Longbridge lists it. */
const filing = (id: string, form: string, at: string, role = "Filer") => ({
  id,
  title: `蘋果 | ${form} - Apple Inc. (0000320193) (${role})`,
  description: "",
  file_name: `${form} - Apple Inc. (0000320193) (${role})`,
  file_urls: [`https://www.sec.gov/Archives/edgar/data/320193/${id}/doc.htm`],
  publish_at: seconds(at),
});

function fakeLongbridge(answer: () => Response) {
  const asked: Request[] = [];

  const filings = createLongbridgeFilings({
    api: createLongbridgeApi({
      accessToken: async () => TOKEN,
      fetch: async (input, init) => {
        asked.push(new Request(input, init));

        return answer();
      },
    }),
  });

  return { asked, filings };
}

const listed = (items: object[]) => () =>
  Response.json({ code: 0, message: "success", data: { items } });

test("lists a listing's filings newest first, each named by its form and linked to the SEC's copy", async () => {
  const { filings, asked } = fakeLongbridge(
    listed([
      filing("1", "10-Q", "2026-07-31T20:30:00Z"),
      filing("2", "8-K", "2026-10-22T20:30:00Z"),
      filing("3", "144", "2026-10-15T21:00:00Z", "Subject"),
      filing("4", "S-3ASR", "2026-09-01T12:00:00Z"),
    ])
  );

  expect(filings.channel).toBe(NewsChannel.Announcement);

  const items = await filings.search({
    ...APPLE,
    since: new Date("2026-08-01T00:00:00Z"),
    limit: 10,
  });

  expect(items).toEqual([
    {
      id: "https://www.sec.gov/Archives/edgar/data/320193/2/doc.htm",
      url: "https://www.sec.gov/Archives/edgar/data/320193/2/doc.htm",
      title: "8-K: current report of a material event",
      snippet: "",
      site: "sec.gov",
      published: {
        at: new Date("2026-10-22T20:30:00Z"),
        precision: TimePrecision.Minute,
      },
      votes: null,
    },
    expect.objectContaining({
      title: "144: an insider's notice of a proposed sale",
    }),
    // A form the app has no words for is named by its code alone.
    expect.objectContaining({ title: "S-3ASR: filing" }),
  ]);

  const url = new URL(asked[0].url);

  expect(url.origin + url.pathname).toBe(
    "https://openapi.longbridge.com/v1/quote/filings"
  );
  expect(url.searchParams.get("symbol")).toBe("AAPL.US");
  expect(asked[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  expect(asked[0].headers.get("x-dc-region")).toBe("ap");
});

test("an insider's report of what they hold is left out, since its title tells nothing of it", async () => {
  const { filings } = fakeLongbridge(
    listed([
      filing("1", "4", "2026-10-22T22:32:00Z", "Issuer"),
      filing("2", "3", "2026-10-20T22:00:00Z", "Issuer"),
      filing("3", "8-K", "2026-10-21T20:30:00Z"),
      // A title that names no form.
      {
        ...filing("4", "", "2026-10-21T20:30:00Z"),
        title: "Apple Inc. (Subject)",
      },
    ])
  );

  const items = await filings.search({
    ...APPLE,
    since: new Date("2026-10-01T00:00:00Z"),
    limit: 10,
  });

  expect(items.map(({ title }) => title)).toEqual([
    "8-K: current report of a material event",
  ]);
});

test("keeps to the limit, and drops a filing that does not read", async () => {
  const { filings } = fakeLongbridge(
    listed([
      filing("1", "8-K", "2026-10-22T20:30:00Z"),
      filing("2", "8-K", "2026-10-21T20:30:00Z"),
      { id: 3, title: null },
    ])
  );

  const items = await filings.search({
    ...APPLE,
    since: new Date("2026-10-01T00:00:00Z"),
    limit: 1,
  });

  expect(items.map(({ published }) => published?.at)).toEqual([
    new Date("2026-10-22T20:30:00Z"),
  ]);
});

test("a refusal names Longbridge and its reason, and an answer none of whose filings read fails", async () => {
  const refused = fakeLongbridge(() =>
    Response.json({ code: 401_003, message: "token expired", data: null })
  );

  await expect(
    refused.filings.search({ ...APPLE, since: new Date(0), limit: 10 })
  ).rejects.toThrow("Longbridge refused the filings of AAPL: token expired");

  const garbled = fakeLongbridge(listed([{ id: 1 }]));

  await expect(
    garbled.filings.search({ ...APPLE, since: new Date(0), limit: 10 })
  ).rejects.toThrow("none of the 1 filings of AAPL read as expected");
});

test("a request refused as too frequent is tried again", async () => {
  let answered = 0;

  const { filings } = fakeLongbridge(() => {
    answered += 1;

    return answered === 1
      ? Response.json(
          { code: 429_001, message: "請 0.2 秒後重試", data: null },
          { status: 429, headers: { "retry-after": "0" } }
        )
      : listed([filing("1", "8-K", "2026-10-22T20:30:00Z")])();
  });

  expect(
    await filings.search({ ...APPLE, since: new Date(0), limit: 10 })
  ).toHaveLength(1);
});
