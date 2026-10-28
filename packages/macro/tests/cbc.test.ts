import { expect, test, vi } from "vite-plus/test";

import { createCbc } from "../src/cbc.ts";

/** The API's answer, as the JSON text it sends. */
const answer = (json: string, status = 200) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(json, {
        status,
        headers: { "content-type": "application/json" },
      })
  );

test("reads the newest close, leaving out a row that does not parse", async () => {
  const cbc = createCbc({
    fetch: answer(
      JSON.stringify([
        { 日期: "20261027", NTD_USD: "32.452" },
        { 日期: "20261028", NTD_USD: "32.418" },
        { 日期: "20261029", NTD_USD: "" },
        { 日期: "2026/10/30", NTD_USD: "32.5" },
      ])
    ),
  });

  await expect(cbc.latest()).resolves.toEqual({
    date: "2026-10-28",
    twdPerUsd: 32.418,
  });
});

test("fails naming the source when it lists no rate", async () => {
  await expect(createCbc({ fetch: answer("[]") }).latest()).rejects.toThrow(
    "The central bank listed no exchange rate"
  );

  await expect(
    createCbc({ fetch: answer(JSON.stringify({ error: "busy" })) }).latest()
  ).rejects.toThrow("The central bank's exchange rates did not read");
});

test("names the source when it refuses", async () => {
  const cbc = createCbc({ fetch: answer("{}", 503) });

  await expect(cbc.latest()).rejects.toThrow("The central bank answered 503");
});
