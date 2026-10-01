import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { agentChannels } from "#shared/ipc/agent.ts";
import type { AgentApi } from "#shared/ipc/agent.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const idSchema = z.string().min(1);

const handle = ipcModule<AgentApi>(agentChannels, {
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
    z.string().min(2).max(35),
  ]),
  abort: z.tuple([idSchema]),
  approve: z.tuple([idSchema, idSchema, z.boolean()]),
});

export function registerAgentIpc({ agent }: Services) {
  handle("sessions", () => agent.sessions());

  handle("createSession", () => agent.createSession());

  handle("deleteSession", (id) => agent.deleteSession(id));

  handle("transcript", (id) => agent.transcript(id));

  handle("send", (id, text, focus, locale) =>
    agent.send(id, text, focus, locale)
  );

  handle("abort", (id) => agent.abort(id));

  handle("approve", async (id, toolCallId, approved) =>
    agent.approve(id, toolCallId, approved)
  );
}
