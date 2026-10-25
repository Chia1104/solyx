import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import * as z from "zod";

import type { StrategyVersionFiles } from "@solyx/api/strategies";
import { readJson, writeFileAtomic } from "@solyx/utils/server";

import { strategyTexts } from "./strategy-folder.ts";
import type { Strategy } from "./strategy-folder.ts";

const snapshotSchema = z.object({
  version: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      bytes: z.number(),
      digest: z.string(),
      text: z.string().nullable(),
    })
  ),
});

/**
 * The files of the versions of each strategy that were allowed, one file a version, so a window
 * shows what changed since the last before the user allows another. What it keeps is for showing
 * alone: an approval is the secret store's, and a run reads only the strategy's folder.
 */
export function createStrategySnapshots(folder: string) {
  const place = (name: string, version: string) =>
    join(folder, name, `${version}.json`);

  return {
    async keep(strategy: Strategy) {
      const { name } = strategy.manifest;

      const snapshot: StrategyVersionFiles = {
        version: strategy.version,
        files: strategyTexts(strategy),
      };

      await writeFileAtomic(
        place(name, strategy.version),
        JSON.stringify(snapshot)
      );
    },

    read: async (
      name: string,
      version: string
    ): Promise<StrategyVersionFiles | null> =>
      (await readJson(place(name, version), snapshotSchema)) ?? null,

    /** Removes the files of `name`'s versions other than `kept`. */
    async keepOnly(name: string, kept: ReadonlySet<string>) {
      let files: string[];

      try {
        files = await readdir(join(folder, name));
      } catch {
        // A strategy never allowed has nothing kept.
        return;
      }

      await Promise.all(
        files
          .filter((file) => !kept.has(file.replace(/\.json$/, "")))
          .map((file) => rm(join(folder, name, file), { force: true }))
      );
    },
  };
}

export type StrategySnapshots = ReturnType<typeof createStrategySnapshots>;
