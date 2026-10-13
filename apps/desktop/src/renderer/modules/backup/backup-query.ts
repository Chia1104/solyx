import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const backupQueryKeys = {
  all: ["backup"] as const,
  settings: ["backup", "settings"] as const,
  status: ["backup", "status"] as const,
  list: ["backup", "list"] as const,
};

/** Never stale, as below. */
export const backupSettingsQuery = () =>
  queryOptions({
    queryKey: backupQueryKeys.settings,
    queryFn: () => window.solyx.backup.settings(),
    staleTime: Infinity,
  });

/** Never stale: the main process says whenever a backup or a restore moves on or its setup changes. */
export const backupStatusQuery = () =>
  queryOptions({
    queryKey: backupQueryKeys.status,
    queryFn: () => window.solyx.backup.status(),
    staleTime: Infinity,
  });

/** Read from the bucket only once the user asks, and again each time they do. */
export const storedBackupsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: backupQueryKeys.list,
    queryFn: () => window.solyx.backup.list(),
    enabled,
    staleTime: 0,
    retry: false,
  });

/** Refetches where backups go and what is going on whenever either changes. */
export function followBackupChanges(queryClient: QueryClient) {
  window.solyx.backup.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: backupQueryKeys.settings });
    void queryClient.invalidateQueries({ queryKey: backupQueryKeys.status });
  });
}
