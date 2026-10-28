import type { NewsSource } from "@solyx/core/news";
import type { WebSearch } from "@solyx/core/web-search";
import type { LongbridgeApi } from "@solyx/market-data/longbridge-api";
import { createAnnouncements } from "@solyx/news/announcements";
import { createInsiderTransfers } from "@solyx/news/insider-transfers";
import { createLongbridgeFilings } from "@solyx/news/longbridge-filings";
import { createPtt } from "@solyx/news/ptt";
import { createWebNews, createWebSocial } from "@solyx/news/web";

/** The user's Longbridge sign-in, which US filings are read on. */
export interface LongbridgeFilingsAccess {
  signedIn(): Promise<boolean>;
  api: LongbridgeApi;
}

/**
 * The sources the app searches, in the order the agent reads them: the company's own word and its
 * insiders' declarations first. The keyless ones always, US filings while the user is signed in to
 * Longbridge, and the web search's once the user saves its vendor's key.
 */
export function createNewsSources(
  web: () => Promise<WebSearch | undefined>,
  longbridge: LongbridgeFilingsAccess
) {
  const filed = [createAnnouncements(), createInsiderTransfers()];

  const usFiled = createLongbridgeFilings({ api: longbridge.api });

  const ptt = createPtt();

  return async (): Promise<NewsSource[]> => {
    const [search, signedIn] = await Promise.all([
      web(),
      longbridge.signedIn(),
    ]);

    const own = signedIn ? [...filed, usFiled] : filed;

    if (search === undefined) return [...own, ptt];

    return [...own, createWebNews(search), ptt, createWebSocial(search)];
  };
}
