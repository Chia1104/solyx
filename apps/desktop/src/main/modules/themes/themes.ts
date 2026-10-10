import type { ClaimAuditor } from "@solyx/core/report";
import { ThemeDesk } from "@solyx/core/theme";
import type { Theme, ThemeDraft, ThemeStore } from "@solyx/core/theme";
import { WebSearchKind } from "@solyx/core/web-search";
import type { WebSearch } from "@solyx/core/web-search";

import type { ScheduledWork } from "../../scheduler.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

const HOUR_MS = 60 * 60 * 1000;

const DAY_MS = 24 * HOUR_MS;

// A theme moves over weeks, so a day between searches loses nothing and spends little.
const SEARCH_EVERY_MS = DAY_MS;

// Often enough that a theme written today is searched within the hour.
const PASS_EVERY_MS = HOUR_MS;

// A theme's first search reaches back a fortnight; later ones overlap the last by a day.
const FIRST_LOOKBACK_MS = 14 * DAY_MS;

const OVERLAP_MS = DAY_MS;

// Per query.
const SEARCH_ITEMS = 10;

export interface ThemesOptions {
  store: ThemeStore;
  /** The web search vendor the user set up; `undefined` until its key is saved. */
  web: () => Promise<WebSearch | undefined>;
  /** Reads what a search found against a theme's signposts; none until a decisions model is set up. */
  auditor: () => Promise<ClaimAuditor | undefined>;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** Called after a theme, or what is found or read for one, changes. */
  onChange: () => void;
  /** @default Date.now */
  now?: () => number;
}

/**
 * The user's themes as the main process watches them: the one `ThemeDesk` over the user's
 * database, and a daily news search of each theme's queries through the web search vendor the
 * user set up, on no market's calendar since a theme is not one market's. Without that vendor
 * nothing is searched, and what is found goes unread until a decisions model is set up.
 */
export function createThemes({
  store,
  web,
  auditor,
  diagnostics,
  onChange,
  now = Date.now,
}: ThemesOptions) {
  const desk = new ThemeDesk({ store, auditor, onChange, now });

  /** Searches each of the theme's queries and hands the desk what they found; a query that fails leaves the others'. */
  async function search(theme: Theme, vendor: WebSearch) {
    const at = now();
    const last = store.collectedAt(theme.id);

    const since = new Date(
      last === null ? at - FIRST_LOOKBACK_MS : last - OVERLAP_MS
    );

    const found = await Promise.allSettled(
      theme.queries.map((text) =>
        vendor.search({
          text,
          kind: WebSearchKind.News,
          since,
          sites: [],
          market: null,
          limit: SEARCH_ITEMS,
        })
      )
    );

    for (const result of found) {
      if (result.status === "rejected") {
        diagnostics.recovered(result.reason, "themes.search", {
          "solyx.theme": theme.id,
        });
      }
    }

    // A search that failed whole is tried again at the next pass rather than counted as made.
    if (found.every((result) => result.status === "rejected")) return;

    await desk.take(
      theme.id,
      found.flatMap((result) =>
        result.status === "fulfilled"
          ? result.value.map((page) => ({
              id: page.url,
              url: page.url,
              title: page.title,
              snippet: page.snippet,
              site: page.site,
              published: page.published,
              foundAt: at,
            }))
          : []
      )
    );
  }

  function existing(id: string): Theme {
    const theme = store.get(id);

    if (!theme) throw new Error("That theme no longer exists");

    return theme;
  }

  const work: ScheduledWork = {
    everyMs: PASS_EVERY_MS,

    /** Searches each theme whose last search is a day old, one after another, so the vendor sees no burst. */
    async run() {
      const vendor = await web();

      if (!vendor) return;

      for (const theme of store.list()) {
        const last = store.collectedAt(theme.id);

        if (last === null || now() - last >= SEARCH_EVERY_MS) {
          await search(theme, vendor);
        }
      }
    },
  };

  return {
    desk,
    work,

    /** Writes a theme again; refused for one removed meanwhile, which saving would bring back. */
    update(id: string, draft: ThemeDraft) {
      existing(id);
      desk.save(draft, id);
    },

    /** Searches for the theme now; refused while no web search vendor is set up. */
    async check(id: string) {
      const theme = existing(id);

      const vendor = await web();

      if (!vendor) {
        throw new Error(
          "No web search is set up: a theme is searched through the web search vendor once its key is saved in Settings"
        );
      }

      await search(theme, vendor);
    },
  };
}

export type Themes = ReturnType<typeof createThemes>;
