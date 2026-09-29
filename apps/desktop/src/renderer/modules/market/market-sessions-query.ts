import { queryOptions } from "@tanstack/react-query";

export const marketQueryKeys = {
  all: ["market"] as const,
  sessions: ["market", "sessions"] as const,
};

/** Sessions change with the clock rather than with any write, so they poll. */
export const marketSessionsQuery = () =>
  queryOptions({
    queryKey: marketQueryKeys.sessions,
    queryFn: () => window.solyx.market.sessions(),
    refetchInterval: 5 * 1000,
  });
