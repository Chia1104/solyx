import * as z from "zod";

import {
  backupChannels,
  backupIntervalSchema,
  backupSettingSchema,
} from "#shared/ipc/backup.ts";
import type { BackupApi } from "#shared/ipc/backup.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  settings: z.tuple([]),
  // Checked against the setting it is for where it is saved.
  set: z.tuple([backupSettingSchema, z.string().trim().max(2048).nullable()]),
  setAutomatic: z.tuple([z.boolean()]),
  setEvery: z.tuple([backupIntervalSchema]),
  status: z.tuple([]),
  backUp: z.tuple([]),
  list: z.tuple([]),
  restore: z.tuple([z.string().min(1).max(1024)]),
};

export function registerBackupIpc({ backups }: Services) {
  bindIpc<BackupApi>(backupChannels, schemas, backups);
}
