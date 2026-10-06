import { queryOptions } from "@tanstack/react-query";

export const storageQueryKeys = {
  all: ["storage"] as const,
};

/** Measured afresh whenever the page shows, since nothing pushes what the files take up. */
export const storageUsageQuery = () =>
  queryOptions({
    queryKey: storageQueryKeys.all,
    queryFn: () => window.solyx.storage.usage(),
    staleTime: 0,
  });
