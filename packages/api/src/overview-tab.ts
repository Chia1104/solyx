import * as z from "zod";

import { Market } from "@solyx/core/market";

/** The overview's tabs, kept in the URL so going back to the overview opens the one left. */
export const OverviewTab = {
  Today: "today",
  News: "news",
  Calendar: "calendar",
  Market: "market",
} as const;

export type OverviewTab = (typeof OverviewTab)[keyof typeof OverviewTab];

export const overviewTabSchema = z.enum(OverviewTab);

/**
 * The market a tab keeps to, `null` for every market, where the URL names `market` or none. The
 * market tab shows one market's sectors and trading, so it keeps to Taiwan unless another is named.
 */
export const overviewMarket = (
  tab: OverviewTab,
  market: Market | undefined
): Market | null => market ?? (tab === OverviewTab.Market ? Market.TW : null);

/** The tab's address in the router's hash, kept to `market` where one is given, which the agent's replies link to. */
export const overviewLink = (tab: OverviewTab, market?: Market) =>
  market ? `#/?tab=${tab}&market=${market}` : `#/?tab=${tab}`;
