import * as z from "zod";

/** The overview's tabs, kept in the URL so going back to the overview opens the one left. */
export const OverviewTab = {
  Today: "today",
  News: "news",
  Calendar: "calendar",
  Market: "market",
} as const;

export type OverviewTab = (typeof OverviewTab)[keyof typeof OverviewTab];

export const overviewTabSchema = z.enum(OverviewTab);

/** The tab's address in the router's hash, which the agent's replies link to. */
export const overviewLink = (tab: OverviewTab) => `#/?tab=${tab}`;
