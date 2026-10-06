import type { NewsSource } from "@solyx/core/news";
import type { WebSearch } from "@solyx/core/web-search";
import { createAnnouncements } from "@solyx/news/announcements";
import { createPtt } from "@solyx/news/ptt";
import { createWebNews, createWebSocial } from "@solyx/news/web";

/**
 * The sources the app searches, in the order the agent reads them: the company's own word first.
 * The keyless ones always, the web search's once the user saves its vendor's key.
 */
export function createNewsSources(web: () => Promise<WebSearch | undefined>) {
  const announcements = createAnnouncements();
  const ptt = createPtt();

  return async (): Promise<NewsSource[]> => {
    const search = await web();

    if (search === undefined) return [announcements, ptt];

    return [announcements, createWebNews(search), ptt, createWebSocial(search)];
  };
}
