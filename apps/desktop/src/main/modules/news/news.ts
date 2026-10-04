import type { NewsSource } from "@solyx/core/news";
import { createAnnouncements } from "@solyx/news/announcements";
import {
  createFirecrawlNews,
  createFirecrawlSocial,
} from "@solyx/news/firecrawl";
import { createPtt } from "@solyx/news/ptt";

import { Secret } from "#shared/ipc/settings.ts";

import type { SecretStore } from "../settings/secret-store.ts";

export interface NewsOptions {
  secrets: SecretStore;
}

/** The sources the agent searches: the keyless ones always, Firecrawl's once its key is saved. */
export function createNews({ secrets }: NewsOptions) {
  const announcements = createAnnouncements();
  const ptt = createPtt();

  return {
    /** In the order the agent reads them: the company's own word first. */
    async sources(): Promise<NewsSource[]> {
      const apiKey = await secrets.get(Secret.FirecrawlApiKey);

      if (apiKey === undefined) return [announcements, ptt];

      return [
        announcements,
        createFirecrawlNews({ apiKey }),
        ptt,
        createFirecrawlSocial({ apiKey }),
      ];
    },
  };
}
