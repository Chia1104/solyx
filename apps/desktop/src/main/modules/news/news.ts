import { debounce } from "es-toolkit";
import type { DebouncedFunction } from "es-toolkit";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { NewsSource, NewsStore } from "@solyx/core/news";
import { createAnnouncements } from "@solyx/news/announcements";
import {
  createFirecrawlNews,
  createFirecrawlSocial,
} from "@solyx/news/firecrawl";
import { createPtt } from "@solyx/news/ptt";

import { Secret } from "#shared/ipc/settings.ts";

import type { SecretStore } from "../settings/secret-store.ts";

// A collection saves each source's items, marks the listing and then saves each score, so changes
// are told once settled.
const CHANGE_DELAY_MS = 1000;

export interface NewsOptions {
  secrets: SecretStore;
  store: NewsStore;
  /** Called once what is stored about a listing settles after a change. */
  onChange: (symbol: SymbolRef) => void;
}

/**
 * The sources the agent and the collector search, the keyless ones always and Firecrawl's once its
 * key is saved, and the store they save into.
 */
export function createNews({ secrets, store, onChange }: NewsOptions) {
  const announcements = createAnnouncements();
  const ptt = createPtt();
  const changes = new Map<string, DebouncedFunction<() => void>>();

  function changed(symbol: SymbolRef) {
    const key = symbolKey(symbol);
    let notify = changes.get(key);

    if (!notify) {
      notify = debounce(() => onChange(symbol), CHANGE_DELAY_MS);
      changes.set(key, notify);
    }

    notify();
  }

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

    store: {
      ...store,
      save(symbol, source, items, foundAt) {
        store.save(symbol, source, items, foundAt);
        changed(symbol);
      },
      saveScore(symbol, record, score) {
        store.saveScore(symbol, record, score);
        changed(symbol);
      },
      // Sources may have failed without saving anything, which changes their health.
      markCollected(symbol, at) {
        store.markCollected(symbol, at);
        changed(symbol);
      },
    } satisfies NewsStore,
  };
}

export type News = ReturnType<typeof createNews>;
