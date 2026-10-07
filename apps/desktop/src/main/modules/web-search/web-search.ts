import { zipObject } from "es-toolkit";

import type { WebReader, WebSearch } from "@solyx/core/web-search";
import { createExa } from "@solyx/web-search/exa";
import { createFirecrawl } from "@solyx/web-search/firecrawl";
import { WebSearchProvider } from "@solyx/web-search/provider";
import { createTavily } from "@solyx/web-search/tavily";

import { webSearchKeySecret } from "#shared/ipc/settings.ts";
import type { WebSearchSettings } from "#shared/ipc/settings.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

export interface WebSearchOptions {
  config: ConfigFile;
  secrets: SecretStore;
}

/** A vendor's search and reader on the user's key. */
export type WebVendor = WebSearch & WebReader;

const VENDORS: Record<WebSearchProvider, (apiKey: string) => WebVendor> = {
  [WebSearchProvider.Firecrawl]: (apiKey) => createFirecrawl({ apiKey }),
  [WebSearchProvider.Exa]: (apiKey) => createExa({ apiKey }),
  [WebSearchProvider.Tavily]: (apiKey) => createTavily({ apiKey }),
};

/**
 * The web search vendor the config file and its saved key pick, which news and the agent both
 * search and read through. Read afresh on every use, so a changed vendor or key applies to the
 * next search without a restart.
 */
export function createWebSearch({ config, secrets }: WebSearchOptions) {
  return {
    async settings(): Promise<WebSearchSettings> {
      const providers = Object.values(WebSearchProvider);

      return {
        provider: config.read().webSearch.provider,
        keys: zipObject(
          providers,
          await Promise.all(
            providers.map((provider) =>
              secrets.state(webSearchKeySecret(provider))
            )
          )
        ),
      };
    },

    /** `undefined` until the user saves the chosen vendor's key. */
    async vendor(): Promise<WebVendor | undefined> {
      const { provider } = config.read().webSearch;
      const apiKey = await secrets.get(webSearchKeySecret(provider));

      return apiKey === undefined ? undefined : VENDORS[provider](apiKey);
    },
  };
}

export type WebSearchModule = ReturnType<typeof createWebSearch>;
