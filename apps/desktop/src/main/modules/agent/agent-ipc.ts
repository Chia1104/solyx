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
});

export function registerAgentIpc({ agent, userData }: Services) {
  const sessions = userData.agentSessions;

  handle("sessions", async () => sessions.list());

  handle("createSession", async () => {
    const at = Date.now();

    const session = {
      id: crypto.randomUUID(),
      title: "",
      createdAt: at,
      updatedAt: at,
    };

    sessions.create(session);

    return session;
  });

  handle("deleteSession", async (id) => {
    await agent.runtime.stop(id);
    sessions.delete(id);
  });

  handle("transcript", async (id) => agent.runtime.transcript(id));

  handle("send", (id, text, focus, locale) =>
    agent.send(id, text, focus, locale)
  );

  handle("abort", async (id) => agent.runtime.abort(id));
}
