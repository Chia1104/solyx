import { queryOptions } from "@tanstack/react-query";

const all = ["market"] as const;

export const marketQueryKeys = {
  all,
  sessions: [...all, "sessions"] as const,
};

/** Sessions change with the clock rather than with any write, so they poll. */
export const marketSessionsQuery = () =>
  queryOptions({
    queryKey: marketQueryKeys.sessions,
    queryFn: () => window.solyx.market.sessions(),
    refetchInterval: 5 * 1000,
  });
