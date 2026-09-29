import { queryOptions } from "@tanstack/react-query";

export const watchlistQueryKeys = {
  all: ["watchlist"] as const,
};

export const watchlistQuery = () =>
  queryOptions({
    queryKey: watchlistQueryKeys.all,
    queryFn: () => window.solyx.watchlist.list(),
  });
