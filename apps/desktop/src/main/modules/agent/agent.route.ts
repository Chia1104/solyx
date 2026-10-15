import { contractOS } from "../../rpc/context.ts";

const { agent } = contractOS;

export const agentRouter = agent.router({
  sessions: agent.sessions.handler(({ context }) => context.agent.sessions()),
  createSession: agent.createSession.handler(({ context, input }) =>
    context.agent.createSession(input)
  ),
  deleteSession: agent.deleteSession.handler(({ context, input }) =>
    context.agent.deleteSession(input)
  ),
  transcript: agent.transcript.handler(({ context, input }) =>
    context.agent.transcript(input)
  ),
  send: agent.send.handler(({ context, input }) =>
    context.agent.send(
      input.id,
      input.text,
      input.screen,
      input.locale,
      input.timeZone
    )
  ),
  abort: agent.abort.handler(({ context, input }) =>
    context.agent.abort(input)
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
