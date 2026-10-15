import * as z from "zod";

import type { AgentWireEvent } from "@solyx/agent/wire";
import { intervalSchema } from "@solyx/core/candles";
import { symbolRefSchema } from "@solyx/core/market";

import { chartIndicatorSchema } from "./chart-indicator.ts";
import { overviewTabSchema } from "./overview-tab.ts";
import { settingsSectionSchema } from "./settings-section.ts";

export const ScreenKind = {
  Listing: "listing",
  Overview: "overview",
  Settings: "settings",
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
  }),
  z.object({ kind: z.literal(ScreenKind.Overview), tab: overviewTabSchema }),
  z.object({
    kind: z.literal(ScreenKind.Settings),
    section: settingsSectionSchema,
  }),
]);

export type AgentScreen = z.infer<typeof agentScreenSchema>;

/** One event of one conversation's run, as every window hears it. */
export interface AgentUpdate {
  sessionId: string;
  event: AgentWireEvent;
}
