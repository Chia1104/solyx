import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as z from "zod";

const providerConfigSchema = z.looseObject({ plan: z.string().optional() });

// Loose objects keep keys this build does not know, so saving never drops someone's edits.
const configSchema = z.looseObject({
  providers: z.record(z.string(), providerConfigSchema).default({}),
});

type Config = z.infer<typeof configSchema>;

/**
 * Settings the main process reads, kept as JSON a person can edit. Every read parses the file,
 * so hand edits apply to the next request; a file that no longer parses counts as empty.
 */
export function createConfigFile(file: string) {
  function read(): Config {
    let text: string;

    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return configSchema.parse({});
      }

      throw error;
    }

    try {
      return configSchema.parse(JSON.parse(text));
    } catch {
      return configSchema.parse({});
    }
  }

  function write(config: Config) {
    const temporary = `${file}.tmp`;

    mkdirSync(dirname(file), { recursive: true });
    // Written aside and renamed into place, so a crash mid-write keeps the previous file.
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, file);
  }

  return {
    /** The plan saved for a provider; the provider decides whether it still sells it. */
    providerPlan: (provider: string): string | undefined =>
      read().providers[provider]?.plan,

    setProviderPlan(provider: string, plan: string) {
      const config = read();

      write({
        ...config,
        providers: {
          ...config.providers,
          [provider]: { ...config.providers[provider], plan },
        },
      });
    },
  };
}

export type ConfigFile = ReturnType<typeof createConfigFile>;
