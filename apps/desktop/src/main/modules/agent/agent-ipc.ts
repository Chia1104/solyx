import * as z from "zod";

import { agentModelPickSchema } from "@solyx/agent/providers";
import { agentSessionSetupSchema, approvalModeSchema } from "@solyx/agent/wire";
import { intervalSchema } from "@solyx/core/candles";
import { symbolRefSchema } from "@solyx/core/market";

import { chartIndicatorSchema } from "#shared/chart-indicator.ts";
import { ScreenKind, agentChannels } from "#shared/ipc/agent.ts";
import type { AgentApi } from "#shared/ipc/agent.ts";
import { overviewTabSchema } from "#shared/overview-tab.ts";
import { settingsSectionSchema } from "#shared/settings-section.ts";
import { localeSchema, timeZoneSchema } from "#shared/settings.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const idSchema = z.string().min(1);

const screenSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(ScreenKind.Listing),
    symbol: symbolRefSchema,
    name: z.string().max(200).optional(),
    interval: intervalSchema,
    indicators: z.array(chartIndicatorSchema),
  }),
  z.object({ kind: z.literal(ScreenKind.Overview), tab: overviewTabSchema }),
  z.object({
    kind: z.literal(ScreenKind.Settings),
    section: settingsSectionSchema,
  }),
]);

const schemas = {
  sessions: z.tuple([]),
  createSession: z.tuple([agentSessionSetupSchema]),
  deleteSession: z.tuple([idSchema]),
  transcript: z.tuple([idSchema]),
  send: z.tuple([
    idSchema,
    z.string().trim().min(1).max(20_000),
    screenSchema.nullable(),
    localeSchema,
    timeZoneSchema,
  ]),
  abort: z.tuple([idSchema]),
  compact: z.tuple([idSchema, z.string().trim().min(1).max(20_000).nullable()]),
  approve: z.tuple([idSchema, idSchema, z.boolean()]),
  setApprovalMode: z.tuple([idSchema, approvalModeSchema]),
  setModel: z.tuple([idSchema, agentModelPickSchema]),
  storeFailed: z.tuple([]),
  restart: z.tuple([]),
};

export function registerAgentIpc({ agent, restart }: Services) {
  bindIpc<AgentApi>(agentChannels, schemas, {
    sessions: () => agent.sessions(),
    createSession: (setup) => agent.createSession(setup),
    deleteSession: (id) => agent.deleteSession(id),
    transcript: (id) => agent.transcript(id),
    send: (id, text, screen, locale, timeZone) =>
      agent.send(id, text, screen, locale, timeZone),
    abort: (id) => agent.abort(id),
    compact: (id, instructions) => agent.compact(id, instructions),
    approve: async (id, toolCallId, approved) =>
      agent.approve(id, toolCallId, approved),
    setApprovalMode: (id, mode) => agent.setApprovalMode(id, mode),
    setModel: (id, pick) => agent.setModel(id, pick),
    storeFailed: async () => agent.storeFailed(),
    restart: async () => restart(),
  });
}
