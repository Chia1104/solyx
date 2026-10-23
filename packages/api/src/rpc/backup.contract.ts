import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { backupIntervalSchema, backupSettingSchema } from "../backup.ts";
import type { BackupSettings, BackupStatus, StoredBackup } from "../backup.ts";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

export const backupContract = {
  settings: oc.meta(forDevices(true)).output(type<BackupSettings>()),
  /** `null` goes back to the default. */
  set: oc
    .input(
      z.object({
        setting: backupSettingSchema,
        // Checked against the setting it is for where it is saved.
        value: z.string().trim().max(2048).nullable(),
      })
    )
    .output(type<void>()),
  setAutomatic: oc.input(z.boolean()).output(type<void>()),
  setEvery: oc.input(backupIntervalSchema).output(type<void>()),
  status: oc.meta(forDevices(true)).output(type<BackupStatus>()),
  /** Uploads a backup of what the app keeps now, sealed under the passphrase, then thins out this installation's older ones. */
  backUp: oc.output(type<StoredBackup>()),
  /** Every backup in the folder, newest first, whichever installation made it. */
  list: oc.meta(forDevices(true)).output(type<StoredBackup[]>()),
  /**
   * Downloads a backup, by its key, and checks it whole, then restarts the app, which puts it in
   * place of what this computer holds as it starts. Keys and sign-ins are not part of a backup.
   */
  restore: oc.input(z.string().min(1).max(1024)).output(type<void>()),
  /** Where backups go, or a backup or a restore, moved on. */
  changes: changesContract,
};
