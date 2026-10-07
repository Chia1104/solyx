import * as z from "zod";

import { agentModelPickSchema } from "@solyx/agent/providers";
import { approvalModeSchema } from "@solyx/agent/wire";
import { symbolRefSchema } from "@solyx/core/market";

import { agentChannels } from "#shared/ipc/agent.ts";
import type { AgentApi } from "#shared/ipc/agent.ts";
import { localeSchema, timeZoneSchema } from "#shared/ipc/settings.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const idSchema = z.string().min(1);

const schemas = {
  sessions: z.tuple([]),
  createSession: z.tuple([]),
  deleteSession: z.tuple([idSchema]),
  transcript: z.tuple([idSchema]),
  send: z.tuple([
    idSchema,
    z.string().trim().min(1).max(20_000),
    z
      .object({ symbol: symbolRefSchema, name: z.string().max(200).optional() })
      .nullable(),
    localeSchema,
    timeZoneSchema,
  ]),
  abort: z.tuple([idSchema]),
  approve: z.tuple([idSchema, idSchema, z.boolean()]),
  setApprovalMode: z.tuple([idSchema, approvalModeSchema]),
  setModel: z.tuple([idSchema, agentModelPickSchema]),
};

export function registerAgentIpc({ agent }: Services) {
  bindIpc<AgentApi>(agentChannels, schemas, {
    sessions: () => agent.sessions(),
    createSession: () => agent.createSession(),
    deleteSession: (id) => agent.deleteSession(id),
    transcript: (id) => agent.transcript(id),
    send: (id, text, focus, locale, timeZone) =>
      agent.send(id, text, focus, locale, timeZone),
    abort: (id) => agent.abort(id),
    approve: async (id, toolCallId, approved) =>
      agent.approve(id, toolCallId, approved),
    setApprovalMode: (id, mode) => agent.setApprovalMode(id, mode),
    setModel: (id, pick) => agent.setModel(id, pick),
  });
}
