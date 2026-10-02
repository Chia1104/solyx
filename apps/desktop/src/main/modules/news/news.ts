import type { NewsSource } from "@solyx/core/news";
import { createFirecrawlNews } from "@solyx/news/firecrawl";

import { Secret } from "#shared/ipc/settings.ts";

import type { SecretStore } from "../settings/secret-store.ts";

export interface NewsOptions {
  secrets: SecretStore;
}

/** Where news comes from, on the key the user saved; read afresh for every search. */
export function createNews({ secrets }: NewsOptions) {
  return {
    /** `undefined` until the user saves a key. */
    async source(): Promise<NewsSource | undefined> {
      const apiKey = await secrets.get(Secret.FirecrawlApiKey);

      return apiKey === undefined ? undefined : createFirecrawlNews({ apiKey });
    },
  };
}
