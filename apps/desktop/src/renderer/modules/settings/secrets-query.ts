import { queryOptions } from "@tanstack/react-query";

export const settingsQueryKeys = {
  all: ["settings"] as const,
  secrets: ["settings", "secrets"] as const,
};

/** Which secrets are saved; their values never leave the main process. */
export const secretsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.secrets,
    queryFn: () => window.solyx.settings.secrets(),
  });
