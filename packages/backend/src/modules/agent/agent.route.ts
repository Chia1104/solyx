import { ORPCError } from "@orpc/server";

import { ApprovalMode } from "@solyx/agent/wire";

import { ClientKind, contractOS } from "../../rpc/context.ts";

const { agent } = contractOS;

export const agentRouter = agent.router({
  sessions: agent.sessions.handler(({ context }) => context.agent.sessions()),
  // A device may not set how a conversation's calls are answered, so it starts one that asks.
  createSession: agent.createSession.handler(({ context, input }) => {
    if (
      context.client.kind === ClientKind.Device &&
      input.approvalMode !== ApprovalMode.Ask
    ) {
      throw new ORPCError("FORBIDDEN", {
        message: "A paired device starts only conversations that ask",
      });
    }

    return context.agent.createSession(input);
  }),
  deleteSession: agent.deleteSession.handler(({ context, input }) =>
    context.agent.deleteSession(input)
  ),
  transcript: agent.transcript.handler(({ context, input }) =>
    context.agent.transcript(input)
  ),
  // A device's message cannot have its run answer for the user, whatever the conversation's mode.
  send: agent.send.handler(({ context, input }) =>
    context.agent.send(
      input.id,
      input.text,
      input.attachments,
      input.screen,
      input.locale,
      input.timeZone,
      context.client.kind === ClientKind.Device
    )
  ),
  abort: agent.abort.handler(({ context, input }) =>
    context.agent.abort(input)
  ),
  retry: agent.retry.handler(({ context, input }) =>
    context.agent.retry(input)
  ),
  compact: agent.compact.handler(({ context, input }) =>
    context.agent.compact(input.id, input.instructions)
  ),
  approve: agent.approve.handler(({ context, input }) =>
    context.agent.approve(input.id, input.toolCallId, input.approved)
  ),
  setApprovalMode: agent.setApprovalMode.handler(({ context, input }) =>
    context.agent.setApprovalMode(input.id, input.mode)
  ),
  setModel: agent.setModel.handler(({ context, input }) =>
    context.agent.setModel(input.id, input.pick)
  ),
  storeFailed: agent.storeFailed.handler(({ context }) =>
    context.agent.storeFailed()
  ),
  restart: agent.restart.handler(({ context }) => context.restart()),
  // Deltas come many times a second, and one dropped would leave a reply short of its words, so
  // this stream keeps every event it has not sent yet.
  events: agent.events.handler(({ context, signal }) =>
    context.windowEvents.subscribe("agent:update", {
      signal,
      maxBufferedEvents: Number.POSITIVE_INFINITY,
    })
  ),
  storeFailures: agent.storeFailures.handler(({ context, signal }) =>
    context.windowEvents.subscribe("agent:store-failed", { signal })
  ),
});
