import { queryOptions } from "@tanstack/react-query";

export const accountQueryKeys = {
  all: ["account"] as const,
};

export const accountQuery = () =>
  queryOptions({
    queryKey: accountQueryKeys.all,
    queryFn: () => window.solyx.account.summary(),
  });
