import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";

import { createPtt } from "../src/ptt.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

/** One search result entry shaped like PTT's markup; `id` is `null` for a deleted post. */
function entry(mark: string, id: string | null, title: string) {
  const nrec = mark ? `<span class="hl f3">${mark}</span>` : "";

  const link = id ? `<a href="/bbs/Stock/${id}.html">${title}</a>` : `${title}`;

  return `
		<div class="r-ent">
			<div class="nrec">${nrec}</div>
			<div class="title">
				${link}
			</div>
			<div class="meta">
				<div class="author">someone</div>
				<div class="date">10/02</div>
				<div class="mark"></div>
			</div>
		</div>`;
}

function fakePtt(html: string) {
  const requests: URL[] = [];

  const fetch = async (input: string | URL | Request) => {
    requests.push(new URL(new Request(input).url));

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  };

  return { fetch, requests };
}

test("finds board titles by the listing's name, with their time and net pushes", async () => {
  const { fetch, requests } = fakePtt(
    [
      // 2026-10-02 12:24:42 UTC
      entry("爆", "M.1790943882.A.49A", "[標的] 2330 台積電 多"),
      entry("", null, "(本文已被刪除) [someone]"),
      entry("X2", "M.1790933335.A.EC9", "[新聞] 台積電 &amp; 德州"),
      entry("", "M.1790900000.A.001", "[請益] 台積電還能上車嗎"),
      // 2026-09-20, before the range.
      entry("12", "M.1789900000.A.002", "[心得] 舊文"),
    ].join("\n")
  );

  const items = await createPtt({ fetch }).search({
    symbol: TSMC,
    listing: { name: "台積電", englishName: "TSMC" },
    since: new Date("2026-09-26T00:00:00Z"),
    limit: 10,
  });

  expect(requests[0].href).toBe(
    "https://www.ptt.cc/bbs/Stock/search?q=%E5%8F%B0%E7%A9%8D%E9%9B%BB"
  );
  expect(items).toEqual([
    {
      id: "https://www.ptt.cc/bbs/Stock/M.1790943882.A.49A.html",
      url: "https://www.ptt.cc/bbs/Stock/M.1790943882.A.49A.html",
      title: "[標的] 2330 台積電 多",
      snippet: "",
      site: "ptt.cc",
      published: {
        at: new Date(1_790_943_882_000),
        precision: TimePrecision.Minute,
      },
      votes: 100,
    },
    {
      id: "https://www.ptt.cc/bbs/Stock/M.1790933335.A.EC9.html",
      url: "https://www.ptt.cc/bbs/Stock/M.1790933335.A.EC9.html",
      title: "[新聞] 台積電 & 德州",
      snippet: "",
      site: "ptt.cc",
      published: {
        at: new Date(1_790_933_335_000),
        precision: TimePrecision.Minute,
      },
      votes: -20,
    },
    {
      id: "https://www.ptt.cc/bbs/Stock/M.1790900000.A.001.html",
      url: "https://www.ptt.cc/bbs/Stock/M.1790900000.A.001.html",
      title: "[請益] 台積電還能上車嗎",
      snippet: "",
      site: "ptt.cc",
      published: {
        at: new Date(1_790_900_000_000),
        precision: TimePrecision.Minute,
      },
      votes: 0,
    },
  ]);
});

test("searches by the code when the listing's name is unknown, keeping the newest", async () => {
  const { fetch, requests } = fakePtt(
    [
      entry("5", "M.1790943882.A.49A", "[新聞] 2330 外資買超"),
      entry("3", "M.1790933335.A.EC9", "[新聞] 2330 法說"),
    ].join("\n")
  );

  const items = await createPtt({ fetch }).search({
    symbol: TSMC,
    listing: null,
    since: new Date("2026-09-26T00:00:00Z"),
    limit: 1,
  });

  expect(requests[0].searchParams.get("q")).toBe("2330");
  expect(items.map((item) => item.title)).toEqual(["[新聞] 2330 外資買超"]);
});
