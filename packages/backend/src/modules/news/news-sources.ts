import type { NewsSource } from "@solyx/core/news";
import type { WebSearch } from "@solyx/core/web-search";
import type { LongbridgeApi } from "@solyx/market-data/longbridge-api";
import { createAnnouncements } from "@solyx/news/announcements";
import { createInsiderTransfers } from "@solyx/news/insider-transfers";
import {
  createLongbridgeNews,
  createLongbridgeTopics,
} from "@solyx/news/longbridge-content";
import { createLongbridgeFilings } from "@solyx/news/longbridge-filings";
import { createPtt } from "@solyx/news/ptt";
import { createWebNews, createWebSocial } from "@solyx/news/web";

/** The user's Longbridge sign-in, which US filings, news and community posts are read on. */
export interface LongbridgeNewsAccess {
  signedIn(): Promise<boolean>;
  api: LongbridgeApi;
}

/**
 * The sources the app searches, in the order the agent reads them: the company's own word and its
 * insiders' declarations first, then articles, forums and social posts. The keyless ones always,
 * a US listing's filings, news and community posts while the user is signed in to Longbridge, and
 * the web search's once the user saves its vendor's key, which finds Taiwan's articles and both
 * markets' social posts.
 */
export function createNewsSources(
  web: () => Promise<WebSearch | undefined>,
  longbridge: LongbridgeNewsAccess
) {
  const filed = [createAnnouncements(), createInsiderTransfers()];
  const ptt = createPtt();

  const us = {
    filed: createLongbridgeFilings({ api: longbridge.api }),
    news: createLongbridgeNews({ api: longbridge.api }),
    topics: createLongbridgeTopics({ api: longbridge.api }),
  };

  return async (): Promise<NewsSource[]> => {
    const [search, signedIn] = await Promise.all([
      web(),
      longbridge.signedIn(),
    ]);

    const when = <Source>(on: boolean, source: Source) => (on ? [source] : []);

    return [
      ...filed,
      ...when(signedIn, us.filed),
      ...(search ? [createWebNews(search)] : []),
      ...when(signedIn, us.news),
      ptt,
      ...when(signedIn, us.topics),
      ...(search ? [createWebSocial(search)] : []),
    ];
  };
}
