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
