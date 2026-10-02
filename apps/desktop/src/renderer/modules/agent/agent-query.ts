import { queryOptions } from "@tanstack/react-query";

import { foldEvents } from "@solyx/agent/wire";

export const agentQueryKeys = {
  all: ["agent"] as const,
  sessions: ["agent", "sessions"] as const,
  transcript: (id: string) => ["agent", "transcript", id] as const,
};

/** Most recently active first. */
export const agentSessionsQuery = () =>
  queryOptions({
    queryKey: agentQueryKeys.sessions,
    queryFn: () => window.solyx.agent.sessions(),
  });

/**
 * A conversation folded into what the thread shows. Fetched once; after that, live events fold
 * into the cached view (see `useAgentEvents`), so it never goes stale on its own.
 */
export const transcriptQuery = (id: string) =>
  queryOptions({
    queryKey: agentQueryKeys.transcript(id),
    queryFn: async () => foldEvents(await window.solyx.agent.transcript(id)),
    staleTime: Infinity,
  });
