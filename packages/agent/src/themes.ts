import { randomBytes } from "node:crypto";

import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { compact } from "es-toolkit";
import * as z from "zod";

import { Market, exchangeDate } from "@solyx/core/market";
import type { ThemeDesk, ThemeItem, ThemeWatch } from "@solyx/core/theme";

import { checkedFirst } from "./approval.ts";
import type { ToolGuard } from "./approval.ts";
import { rememberAddresses } from "./found-addresses.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName, saveThemeArgumentsSchema } from "./wire.ts";

export interface ThemeToolsOptions {
  desk: ThemeDesk;
}

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
    ...(latest.length > 0
      ? [
          "Found last:",
          ...latest.slice(0, LISTED_ITEMS).map((item) => `- ${itemText(item)}`),
        ]
      : []),
  ].join("\n");
}

/**
 * The agent's reach into the user's themes: `get_themes` to read them with what watching them has
 * found, and `save_theme` to write one once the user allows it. Removing a theme stays the
 * user's, in the settings.
 */
export function createThemeTools({ desk }: ThemeToolsOptions) {
  const getThemes = defineTool({
    name: AgentToolName.GetThemes,
    replay: "safe",
    description:
      "The themes the user has the app watch: standing topics in the world that move no price now but could reach what they hold over quarters. Each comes with why it matters, the listings it could reach, its signposts, and what the app's daily news search found: items a decisions model read as stating a signpost, which are leads to read rather than facts, and the items found last. Dates are on Taipei's calendar.",
    parameters: z.object({}),
    async execute(_params, api, context) {
      const themes = desk.list();

      await rememberAddresses(
        api,
        compact(
          themes.flatMap(({ developments, latest }) => [
            ...developments.map(({ item }) => item.url),
            ...latest.slice(0, LISTED_ITEMS).map((item) => item.url),
          ])
        ),
        context
      );

      return {
        text:
          themes.length === 0
            ? "The user watches no themes yet."
            : themes.map(watchText).join("\n\n"),
        details: { themes: themes.length },
      };
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
