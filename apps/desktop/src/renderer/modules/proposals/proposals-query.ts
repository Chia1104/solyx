import { queryOptions } from "@tanstack/react-query";

export const proposalsQueryKeys = {
  all: ["proposals"] as const,
};

export const proposalsQuery = () =>
  queryOptions({
    queryKey: proposalsQueryKeys.all,
    queryFn: () => window.solyx.proposals.list(),
  });
