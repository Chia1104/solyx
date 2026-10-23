import { queryOptions, skipToken } from "@tanstack/react-query";

import { foldEvents } from "@solyx/agent/wire";

import { client, orpc } from "../../app/rpc.ts";

const transcripts = ["agent", "transcript"] as const;

/**
 * The conversations' folded views, under keys of their own, since the cache holds what the
 * thread shows rather than what `agent.transcript` answers.
 */
export const agentQueryKeys = {
  transcripts,
  transcript: (id: string | null) => [...transcripts, id] as const,
};

/** Most recently active first. */
export const agentSessionsQuery = () => orpc.agent.sessions.queryOptions();

/**
 * A conversation folded into what the thread shows. Fetched once; after that, live events fold
 * into the cached view (see `followAgentEvents`), so it never goes stale on its own. A new
 * conversation (`null`) has none to fetch.
 */
export const transcriptQuery = (id: string | null) =>
  queryOptions({
    queryKey: agentQueryKeys.transcript(id),
    queryFn:
      id === null
        ? skipToken
        : async () => foldEvents(await client.agent.transcript(id)),
    staleTime: Infinity,
  });

/**
 * Whether the conversations' store failed. The main process says when it does (see
 * `followAgentEvents`), and only a restart undoes it, so it never goes stale on its own.
 */
export const agentStoreFailedQuery = () =>
  orpc.agent.storeFailed.queryOptions({ staleTime: Infinity });
