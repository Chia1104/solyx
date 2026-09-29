import { queryOptions } from "@tanstack/react-query";

export const settingsQueryKeys = {
  all: ["settings"] as const,
  secrets: ["settings", "secrets"] as const,
  marketData: ["settings", "market-data"] as const,
};

/** Which secrets are saved; their values never leave the main process. */
export const secretsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.secrets,
    queryFn: () => window.solyx.settings.secrets(),
  });

/** Always stale, since the settings can also change by hand in the config file. */
export const marketDataQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.marketData,
    queryFn: () => window.solyx.settings.marketData(),
    staleTime: 0,
  });
