import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale, as below. */
export const backupSettingsQuery = () =>
  orpc.backup.settings.queryOptions({ staleTime: Infinity });

/** Never stale: the main process says whenever a backup or a restore moves on or its setup changes. */
export const backupStatusQuery = () =>
  orpc.backup.status.queryOptions({ staleTime: Infinity });

/** Read from the bucket only once the user asks, and again each time they do. */
export const storedBackupsQuery = (enabled: boolean) =>
  orpc.backup.list.queryOptions({ enabled, staleTime: 0, retry: false });

/** Refetches where backups go and what is going on whenever either changes. */
export function followBackupChanges(queryClient: QueryClient) {
  void forEachEvent(client.backup.changes(), () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.backup.settings.key(),
    });
    void queryClient.invalidateQueries({ queryKey: orpc.backup.status.key() });
  });
}
