import { queryOptions, skipToken } from "@tanstack/react-query";

import { foldEvents } from "@solyx/agent/wire";

const all = ["agent"] as const;

const transcripts = [...all, "transcript"] as const;

export const agentQueryKeys = {
  all,
  sessions: [...all, "sessions"] as const,
  transcripts,
  transcript: (id: string | null) => [...transcripts, id] as const,
};

/** Most recently active first. */
export const agentSessionsQuery = () =>
  queryOptions({
    queryKey: agentQueryKeys.sessions,
    queryFn: () => window.solyx.agent.sessions(),
  });

/**
 * A conversation folded into what the thread shows. Fetched once; after that, live events fold
 * into the cached view (see `useAgentEvents`), so it never goes stale on its own. A new
 * conversation (`null`) has none to fetch.
 */
export const transcriptQuery = (id: string | null) =>
  queryOptions({
    queryKey: agentQueryKeys.transcript(id),
    queryFn:
      id === null
        ? skipToken
        : async () => foldEvents(await window.solyx.agent.transcript(id)),
    staleTime: Infinity,
  });
