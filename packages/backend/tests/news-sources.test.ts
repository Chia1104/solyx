import { expect, test } from "vite-plus/test";

import { createLongbridge } from "@solyx/longbridge/client";

import { createNewsSources } from "../src/modules/news/news-sources.ts";

function longbridge(signedIn: boolean) {
  return {
    signedIn: async () => signedIn,
    api: createLongbridge({ accessToken: async () => "hk_access" }),
  };
}

test("a US listing's filings, news and community posts are searched only while the user is signed in to Longbridge", async () => {
  const signedOut = await createNewsSources(
    async () => undefined,
    longbridge(false)
  )();

  expect(signedOut.map(({ id }) => id)).toEqual([
    "mops-announcements",
    "insider-transfers",
    "ptt-stock",
  ]);

  const signedIn = await createNewsSources(
    async () => undefined,
    longbridge(true)
  )();

  expect(signedIn.map(({ id }) => id)).toEqual([
    "mops-announcements",
    "insider-transfers",
    "longbridge-filings",
    "longbridge-news",
    "ptt-stock",
    "longbridge-topics",
  ]);
});
