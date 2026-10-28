import * as z from "zod";

import type { AgentWireEvent } from "@solyx/agent/wire";
import { intervalSchema } from "@solyx/core/candles";
import { symbolRefSchema } from "@solyx/core/market";
import { strategyNameSchema } from "@solyx/core/strategy";

import { backtestSetupSchema } from "./backtests.ts";
import { chartIndicatorSchema } from "./chart-indicator.ts";
import { overviewTabSchema } from "./overview-tab.ts";
import { settingsSectionSchema } from "./settings-section.ts";

export const ScreenKind = {
  Listing: "listing",
  Overview: "overview",
  Settings: "settings",
  Strategies: "strategies",
} as const;

export type ScreenKind = (typeof ScreenKind)[keyof typeof ScreenKind];

/** What the window shows while the user writes, which the agent is told about. */
export const agentScreenSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(ScreenKind.Listing),
    symbol: symbolRefSchema,
    /** The exchange's name for it, as the renderer already shows it. */
    name: z.string().max(200).optional(),
    interval: intervalSchema,
    /** What its chart draws with its bars on that interval. */
    indicators: z.array(chartIndicatorSchema),
    /** The single backtest the panel under its chart shows, as the panel ran it. */
    backtest: backtestSetupSchema.optional(),
  }),
  z.object({ kind: z.literal(ScreenKind.Overview), tab: overviewTabSchema }),
  z.object({
    kind: z.literal(ScreenKind.Settings),
    section: settingsSectionSchema,
  }),
  z.object({
    kind: z.literal(ScreenKind.Strategies),
    /** The strategy whose page is open, where one is. */
    name: strategyNameSchema.optional(),
  }),
]);

export type AgentScreen = z.infer<typeof agentScreenSchema>;

/** One event of one conversation's run, as every window hears it. */
export interface AgentUpdate {
  sessionId: string;
  event: AgentWireEvent;
}

/** The most of a file's text a preview shows, since a file may hold far more than a page draws at once. */
export const PREVIEW_CHARACTERS = 100_000;

/** A file's text as a preview shows it: its first `PREVIEW_CHARACTERS`, and how many it holds. */
export interface FileText {
  text: string;
  characters: number;
}

export const previewText = (text: string): FileText => ({
  text: text.slice(0, PREVIEW_CHARACTERS),
  characters: text.length,
});
