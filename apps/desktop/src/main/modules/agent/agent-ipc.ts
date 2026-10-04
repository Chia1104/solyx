import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { agentChannels } from "#shared/ipc/agent.ts";
import type { AgentApi } from "#shared/ipc/agent.ts";
import { localeSchema } from "#shared/ipc/settings.ts";

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
  ]),
  abort: z.tuple([idSchema]),
  approve: z.tuple([idSchema, idSchema, z.boolean()]),
};

export function registerAgentIpc({ agent }: Services) {
  bindIpc<AgentApi>(agentChannels, schemas, {
    sessions: () => agent.sessions(),
    createSession: () => agent.createSession(),
    deleteSession: (id) => agent.deleteSession(id),
    transcript: (id) => agent.transcript(id),
    send: (id, text, focus, locale) => agent.send(id, text, focus, locale),
    abort: (id) => agent.abort(id),
    approve: async (id, toolCallId, approved) =>
      agent.approve(id, toolCallId, approved),
  });
}
