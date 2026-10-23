import * as z from "zod";

import { readJsonSync, writeFileAtomicSync } from "@solyx/utils/server";

const locationSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  /** The folder in the bucket backups are kept under. */
  folder: z.string(),
});

/** Where backups are kept, by what the settings name of it and no secret. */
export type BackupLocation = z.infer<typeof locationSchema>;

const stateSchema = z.object({
  /** Where the backups remembered here are kept, since another bucket or folder holds none of them. */
  location: locationSchema.nullable(),
  /** When a backup was last made or found unneeded, which the next one made on its own counts from. */
  checkedAt: z.number().nullable(),
  /** When this installation last uploaded a backup. */
  uploadedAt: z.number().nullable(),
  /** What the last uploaded backup held, by its hash, to tell whether anything changed since. */
  digest: z.string().nullable(),
  /** This installation's backups in the bucket as they were last counted. */
  stored: z.object({ count: z.number(), bytes: z.number() }).nullable(),
});

export type BackupState = z.infer<typeof stateSchema>;

/** What is remembered where no backup was made yet. */
export const NEVER: BackupState = {
  location: null,
  checkedAt: null,
  uploadedAt: null,
  digest: null,
  stored: null,
};

/**
 * What the app remembers of its own backups between starts, in a file beside the databases. It is
 * no part of a backup, so restoring one leaves it as this computer wrote it.
 */
export function createBackupState(file: string) {
  return {
    /** A file that is missing or no longer parses reads as never having backed up. */
    read: (): BackupState => readJsonSync(file, stateSchema) ?? NEVER,

    write(state: BackupState) {
      writeFileAtomicSync(file, JSON.stringify(state));
    },
  };
}
