import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { WebSearchKind } from "@solyx/core/web-search";
import { WebSearchProvider } from "@solyx/web-search/provider";

import { webSearchKeySecret } from "#shared/ipc/settings.ts";

import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";
import { createWebSearch } from "../src/main/modules/web-search/web-search.ts";

import { fakeCipher } from "./fake-cipher.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-web-search-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function setup() {
  const config = createConfigFile(join(directory, ".solyx", "config.json"));

  config.create();

  const secrets = createSecretStore(
    join(directory, "secrets.json"),
    fakeCipher().cipher
  );

  return { config, secrets, webSearch: createWebSearch({ config, secrets }) };
}

/** The addresses requests went to, each answered with an empty search. */
function recordRequests() {
  const urls: string[] = [];

  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(new Request(input, init).url);

      return Response.json({ data: { news: [], web: [] }, results: [] });
    }
  );

  return urls;
}

const QUERY = {
  text: "2330",
  kind: WebSearchKind.News,
  since: new Date("2026-09-26T17:00:00Z"),
  sites: [],
  market: Market.TW,
  limit: 10,
};

test("searches through the vendor in use once its own key is saved", async () => {
  const { config, secrets, webSearch } = setup();
  const urls = recordRequests();

  expect(await webSearch.vendor()).toBeUndefined();

  // Another vendor's key does not stand in for the one in use.
  await secrets.save(webSearchKeySecret(WebSearchProvider.Exa), "exa-key");

  expect(await webSearch.vendor()).toBeUndefined();

  config.set(["webSearch", "provider"], WebSearchProvider.Exa);
  await (await webSearch.vendor())?.search(QUERY);

  await secrets.save(
    webSearchKeySecret(WebSearchProvider.Firecrawl),
    "firecrawl-key"
  );
  config.set(["webSearch", "provider"], WebSearchProvider.Firecrawl);
  await (await webSearch.vendor())?.search(QUERY);

  expect(urls).toEqual([
    "https://api.exa.ai/search",
    "https://api.firecrawl.dev/v2/search",
  ]);
});
