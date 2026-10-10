import type { ClaimAuditor } from "@solyx/core/report";
import { collectionDue, nextCollection } from "@solyx/core/schedule";
import type { CollectionPlan } from "@solyx/core/schedule";
import { ThemeDesk } from "@solyx/core/theme";
import type { Theme, ThemeDraft, ThemeStore } from "@solyx/core/theme";
import { WebSearchKind } from "@solyx/core/web-search";
import type { WebSearch } from "@solyx/core/web-search";

import type { CollectionStatus } from "#shared/ipc/schedules.ts";

import type { ScheduledWork } from "../../scheduler.ts";
import type { ScheduleDays } from "../market/schedule-days.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

const HOUR_MS = 60 * 60 * 1000;

const DAY_MS = 24 * HOUR_MS;

// Often enough that a theme written today, or a time of day, is followed within the half hour.
const PASS_EVERY_MS = HOUR_MS / 2;

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
  /** Read before every pass, so a changed plan applies without a restart. */
  plan: () => CollectionPlan;
  days: ScheduleDays;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** Called after a theme, or what is found or read for one, changes. */
  onChange: () => void;
  /** @default Date.now */
  now?: () => number;
}

/**
 * The user's themes as the main process watches them: the one `ThemeDesk` over the user's
 * database, and a news search of each theme's queries as the user's plan has it due, through the
 * web search vendor the user set up, on no market's calendar since a theme is not one market's.
 * Without that vendor nothing is searched, and what is found goes unread until a decisions model
 * is set up.
 */
export function createThemes({
  store,
  web,
  auditor,
  plan,
  days,
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

    /** Searches each theme the user's plan has due, one after another, so the vendor sees no burst. */
    async run() {
      const planned = plan();
      const vendor = planned.enabled ? await web() : undefined;

      if (!vendor) return;

      const trades = await days(planned.schedule);

      for (const theme of store.list()) {
        if (
          collectionDue(planned, store.collectedAt(theme.id), now(), trades)
        ) {
          await search(theme, vendor);
        }
      }
    },
  };

  /** The web search vendor, or a refusal that says what is missing. */
  async function vendorOrRefuse() {
    const vendor = await web();

    if (!vendor) {
      throw new Error(
        "No web search is set up: a theme is searched through the web search vendor once its key is saved in Settings"
      );
    }

    return vendor;
  }

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
      await search(existing(id), await vendorOrRefuse());
    },

    /** Searches for every theme now, whatever the plan says; refused while no web search vendor is set up. */
    async collectNow() {
      const vendor = await vendorOrRefuse();

      for (const theme of store.list()) await search(theme, vendor);
    },

    /** When a theme was last searched for, and when the first of them is next due. */
    async status(): Promise<CollectionStatus> {
      const planned = plan();
      const trades = await days(planned.schedule);
      const at = now();
      const searched = store.list().map(({ id }) => store.collectedAt(id));
      const made = searched.flatMap((last) => last ?? []);

      const due = planned.enabled
        ? searched.flatMap(
            (last) => nextCollection(planned, last, at, trades) ?? []
          )
        : [];

      return {
        lastAt: made.length > 0 ? Math.max(...made) : null,
        nextAt: due.length > 0 ? Math.min(...due) : null,
      };
    },
  };
}

export type Themes = ReturnType<typeof createThemes>;
