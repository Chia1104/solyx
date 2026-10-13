import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as z from "zod";

const stateSchema = z.object({
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

const NEVER: BackupState = {
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
    read(): BackupState {
      try {
        return stateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        return NEVER;
      }
    },

    write(state: BackupState) {
      const temporary = `${file}.tmp`;

      mkdirSync(dirname(file), { recursive: true });
      // Written aside and renamed into place, so a crash mid-write keeps the previous file.
      writeFileSync(temporary, JSON.stringify(state));
      renameSync(temporary, file);
    },
  };
}
