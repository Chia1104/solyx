import { randomBytes } from "node:crypto";

import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { compact } from "es-toolkit";
import * as z from "zod";

import { Market, exchangeDate } from "@solyx/core/market";
import type { ThemeDesk, ThemeItem, ThemeWatch } from "@solyx/core/theme";
import { MINUTE_MS, HOUR_MS } from "@solyx/utils/date";

import { checkedFirst } from "./approval.ts";
import type { ToolGuard } from "./approval.ts";
import { rememberAddresses } from "./found-addresses.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName, saveThemeArgumentsSchema } from "./wire.ts";

export interface ThemeToolsOptions {
  desk: ThemeDesk;
  /** Searches a theme's queries for news now and has the desk take what they find; rejects while no web search is set up. */
  search(id: string): Promise<void>;
  /** @default Date.now */
  now?: () => number;
}

// A search reaches back past the one before it, so one made sooner finds the same items again
// and spends the user's searches for nothing.
const SEARCH_SPAN_MS = HOUR_MS;

// The items listed under a theme: enough to see where it stands without crowding the answer.
const LISTED_ITEMS = 5;

/** The day a moment falls on, on Taipei's calendar, which the app's own times are told on. */
const day = (at: number) => exchangeDate(Market.TW, new Date(at));

const itemText = ({ title, site, url, published, foundAt }: ThemeItem) =>
  `${day(published?.at.getTime() ?? foundAt)} ${site}: ${title}${url ? ` ${url}` : ""}`;

function watchText({
  theme,
  developments,
  latest,
  collectedAt,
  quietSince,
  unread,
}: ThemeWatch): string {
  const listings = theme.listings.map(
    ({ symbol, exposure }) => `- ${symbol.market} ${symbol.symbol}: ${exposure}`
  );

  return [
    `## ${theme.title} (id ${theme.id})`,
    theme.thesis,
    ...(listings.length > 0 ? ["Listings it could reach:", ...listings] : []),
    "Signposts:",
    ...theme.signposts.map((signpost) => `- ${signpost}`),
    `Searched for: ${theme.queries.join("; ")}`,
    collectedAt === null
      ? "Not searched yet."
      : `Last searched ${day(collectedAt)}.`,
    ...(developments.length > 0
      ? [
          "News a decisions model read as stating a signpost; read the item before you rely on it:",
          ...developments.map(
            ({ signpost, item, support }) =>
              `- "${signpost}": ${itemText(item)} (read as stated, ${support.supported.toFixed(2)})`
          ),
        ]
      : [`No signpost read as stated; quiet since ${day(quietSince)}.`]),
    ...(unread > 0
      ? [
          `${unread} of the items found last are not yet read against every signpost, so its quiet says nothing of them: a decisions model reads them once one is set up, or at the next search where it could not read them.`,
        ]
      : []),
    ...(latest.length > 0
      ? [
          "Found last:",
          ...latest.slice(0, LISTED_ITEMS).map((item) => `- ${itemText(item)}`),
        ]
      : []),
  ].join("\n");
}

/** The addresses of the items a theme's answer shows. */
const shownAddresses = ({ developments, latest }: ThemeWatch) =>
  compact([
    ...developments.map(({ item }) => item.url),
    ...latest.slice(0, LISTED_ITEMS).map((item) => item.url),
  ]);

/**
 * The agent's reach into the user's themes: `get_themes` to read them with what watching them has
 * found, `search_theme` to search one now, and `save_theme` to write one once the user allows it.
 * Removing a theme stays the user's, in the settings.
 */
export function createThemeTools({
  desk,
  search,
  now = Date.now,
}: ThemeToolsOptions) {
  function watched(id: string): ThemeWatch {
    const watch = desk.list().find(({ theme }) => theme.id === id);

    if (!watch) {
      throw new Error(`No theme has the id ${id}; get_themes lists them`);
    }

    return watch;
  }

  const getThemes = defineTool({
    name: AgentToolName.GetThemes,
    replay: "safe",
    description:
      "The themes the user has the app watch: standing topics in the world that move no price now but could reach what they hold over quarters. Each comes with why it matters, the listings it could reach, its signposts, and what the app's daily news search found: items a decisions model read as stating a signpost, which are leads to read rather than facts, and the items found last. Dates are on Taipei's calendar.",
    parameters: z.object({}),
    async execute(_params, api, context) {
      const themes = desk.list();

      await rememberAddresses(api, themes.flatMap(shownAddresses), context);

      return {
        text:
          themes.length === 0
            ? "The user watches no themes yet."
            : themes.map(watchText).join("\n\n"),
        details: { themes: themes.length },
      };
    },
  });

  const searchTheme = defineTool({
    name: AgentToolName.SearchTheme,
    replay: "safe",
    description:
      "Searches one theme's queries for news now, where the app would wait for its own search, and reads what it finds against the theme's signposts; it answers with the theme as get_themes gives it. Use it after keeping a theme, so its first search does not wait, or when the user asks what is new on one. It costs the user's web search a search for each of the theme's queries, and their decisions model a read of each new item, so a theme is searched at most once an hour: asked sooner, it answers with what the last search found.",
    parameters: z.object({
      id: z.string().describe("A theme's id from get_themes"),
    }),
    async execute({ id }, api, context) {
      const { collectedAt } = watched(id);
      const sinceLast = collectedAt === null ? null : now() - collectedAt;
      let said: string;

      if (sinceLast !== null && sinceLast < SEARCH_SPAN_MS) {
        said = `Searched ${Math.floor(sinceLast / MINUTE_MS)} minutes ago, and a theme is searched at most once an hour, so this is what that search found.`;
      } else {
        await search(id);

        // A search no query of which was answered is not counted as made.
        said =
          watched(id).collectedAt === collectedAt
            ? "The search could not be made: the web search answered none of the theme's queries. This is the theme as it stood."
            : "Searched now.";
      }

      const watch = watched(id);

      await rememberAddresses(api, shownAddresses(watch), context);

      return { text: [said, watchText(watch)].join("\n"), details: { id } };
    },
  });

  const saveTheme = defineTool({
    name: AgentToolName.SaveTheme,
    // A new theme's id is kept with the call, so a call that runs again writes the same theme.
    replay: "safe",
    description:
      "Keeps a theme for the app to watch, or writes one again whole under its id, once the user allows it. The user sees exactly what you pass, so write it for them too. From then on the app searches its queries for news once a day and reads what it finds against its signposts.",
    parameters: saveThemeArgumentsSchema,
    async execute({ id, ...draft }, api, context) {
      const theme = desk.save(
        draft,
        id ??
          (await api.memo("theme-id", randomBytes(5).toString("hex"), context))
      );

      return {
        text: `${id ? "Wrote" : "Kept"} theme ${theme.id}, "${theme.title}".`,
        details: { id: theme.id },
      };
    },
  });

  return {
    /** Reading rides every request; writing waits for the user through `guard`. */
    extension: (guard: ToolGuard): Extension =>
      defineExtension({
        name: "solyx-themes",
        tools: [
          getThemes,
          searchTheme,
          checkedFirst(guard(saveTheme), saveThemeArgumentsSchema, ({ id }) => {
            if (
              id !== undefined &&
              !desk.list().some(({ theme }) => theme.id === id)
            ) {
              throw new Error(
                `No theme has the id ${id}; leave the id out to keep a new one`
              );
            }
          }),
        ],
      }),
  };
}
