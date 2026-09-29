import { queryOptions } from "@tanstack/react-query";

export const settingsQueryKeys = {
  all: ["settings"] as const,
  secrets: ["settings", "secrets"] as const,
  providerPlans: ["settings", "provider-plans"] as const,
};

/** Which secrets are saved; their values never leave the main process. */
export const secretsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.secrets,
    queryFn: () => window.solyx.settings.secrets(),
  });

/** Always stale, since the plans can also change by hand in the config file. */
export const providerPlansQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.providerPlans,
    queryFn: () => window.solyx.settings.providerPlans(),
    staleTime: 0,
  });
