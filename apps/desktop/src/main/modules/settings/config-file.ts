import {
  mkdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";

import { debounce } from "es-toolkit";
import { applyEdits, modify, parse } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import * as z from "zod";

import {
  AgentAuth,
  AgentProvider,
  AgentThinking,
  DEFAULT_MODEL,
} from "@solyx/agent/providers";
import type { Market } from "@solyx/core/market";
import { FuglePlan } from "@solyx/market-data/fugle";

import { MarketDataSource, Theme } from "#shared/ipc/settings.ts";
import type { FubonFile } from "#shared/ipc/settings.ts";

const PARSE_OPTIONS = { allowTrailingComma: true };

// An entry of the wrong shape reads as missing, so one bad edit leaves the rest of the file in force.
const textSchema = z.string().trim().min(1).optional().catch(undefined);

// Loose objects keep keys this build does not know, so saving never drops someone's edits.
const configSchema = z.looseObject({
  theme: z.enum(Theme).optional().catch(undefined),
  marketData: z.looseObject({ TW: textSchema }).optional().catch(undefined),
  providers: z
    .looseObject({
      fugle: z.looseObject({ plan: textSchema }).optional().catch(undefined),
      fubon: z
        .looseObject({ sdk: textSchema, certificate: textSchema })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  agent: z
    .looseObject({
      provider: textSchema,
      model: textSchema,
      thinking: textSchema,
      auth: textSchema,
      sharedSkills: z.array(z.string()).optional().catch(undefined),
      // Values are checked one by one where they are read, so one bad entry keeps the rest.
      mcpTools: z.record(z.string(), z.string()).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

type Config = z.infer<typeof configSchema>;

/** The values the app edits; the file may hold others a person added. */
export type ConfigPath =
  | ["theme"]
  | ["marketData", typeof Market.TW]
  | ["providers", "fugle", "plan"]
  | ["providers", "fubon", FubonFile]
  | ["agent", "provider" | "model" | "thinking" | "auth" | "sharedSkills"]
  | ["agent", "mcpTools", string];

const quoted = (values: Record<string, string>) =>
  Object.values(values)
    .map((value) => `"${value}"`)
    .join(", ");

const TEMPLATE = [
  "// Settings Solyx reads. Edit them here or on the settings page; saving this file applies them.",
  "{",
  `  // Light or dark, or follow the computer: ${quoted(Theme)}.`,
  `  "theme": "${Theme.System}",`,
  '  "marketData": {',
  `    // Where Taiwan charts come from: ${quoted(MarketDataSource)}.`,
  `    "TW": "${MarketDataSource.Fugle}"`,
  "  },",
  '  "providers": {',
  `    // Your key's plan: ${quoted(FuglePlan)}.`,
  `    "fugle": { "plan": "${FuglePlan.Basic}" },`,
  "    // The folder extracted from Fubon's SDK download, and the certificate exported from its website.",
  '    "fubon": { "sdk": "", "certificate": "" }',
  "  },",
  '  "agent": {',
  `    // Whose models run the agent, on the key saved in the app: ${quoted(AgentProvider)}.`,
  `    "provider": "${AgentProvider.Anthropic}",`,
  "    // The provider's model id; the settings page lists them.",
  `    "model": "${DEFAULT_MODEL[AgentProvider.Anthropic]}",`,
  `    // How long the model thinks before it answers: ${quoted(AgentThinking)}.`,
  `    "thinking": "${AgentThinking.Medium}",`,
  `    // How the provider is paid for: ${quoted(AgentAuth)}; a subscription applies to OpenAI, signed in with ChatGPT.`,
  `    "auth": "${AgentAuth.ApiKey}",`,
  "    // Skills from ~/.agents/skills the agent may read, by name. The skills folder beside this file is always read.",
  '    "sharedSkills": []',
  "  }",
  "}",
  "",
].join("\n");

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function hasSyntaxErrors(text: string): boolean {
  const errors: ParseError[] = [];

  parse(text, errors, PARSE_OPTIONS);

  return errors.length > 0;
}

/**
 * Settings the main process reads, kept as JSONC for a person to edit. Every read parses the
 * file, so saved edits apply to the next request; a file with syntax errors reads as defaults
 * and is never overwritten, and the app edits values in place so comments survive.
 */
export function createConfigFile(file: string) {
  function write(text: string) {
    const temporary = `${file}.tmp`;

    mkdirSync(dirname(file), { recursive: true });
    // Written aside and renamed into place, so a crash mid-write keeps the previous file.
    writeFileSync(temporary, text, { mode: 0o600 });
    renameSync(temporary, file);
  }

  return {
    file,

    /** Writes a commented template when the file does not exist yet, so there is something to edit. */
    create() {
      if (readText(file) === undefined) write(TEMPLATE);
    },

    /** The saved settings; whoever reads a value decides whether it is still valid. */
    read(): Config {
      const text = readText(file);
      const errors: ParseError[] = [];

      const value =
        text === undefined ? {} : parse(text, errors, PARSE_OPTIONS);

      return (
        (errors.length === 0
          ? configSchema.safeParse(value).data
          : undefined) ?? {}
      );
    },

    set(path: ConfigPath, value: string | string[]) {
      const text = readText(file) ?? TEMPLATE;

      if (hasSyntaxErrors(text)) {
        throw new Error(`Fix the syntax errors in ${file} before saving`);
      }

      write(
        applyEdits(
          text,
          modify(text, path, value, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          })
        )
      );
    },

    /** Calls `onChange` shortly after the file changes on disk, whoever changed it. */
    watch(onChange: () => void): () => void {
      const notify = debounce(onChange, 200);

      mkdirSync(dirname(file), { recursive: true });

      // Editors often save by renaming a new file into place, so the folder is watched.
      const watcher = watch(dirname(file), (_event, name) => {
        if (name === basename(file)) notify();
      });

      return () => {
        notify.cancel();
        watcher.close();
      };
    },
  };
}

export type ConfigFile = ReturnType<typeof createConfigFile>;
