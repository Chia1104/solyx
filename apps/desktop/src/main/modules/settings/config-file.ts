import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
} from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import * as z from "zod";

import {
  AgentAuth,
  AgentProvider,
  AgentThinking,
  DEFAULT_MODEL,
  agentAuthSchema,
  agentProviderSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import type { Market } from "@solyx/core/market";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
} from "@solyx/decisions/typesafe";
import { FuglePlan, fuglePlanSchema } from "@solyx/market-data/fugle";
import { isErrnoError } from "@solyx/utils/error";
import { watchFile } from "@solyx/utils/server";

import {
  MarketDataSource,
  NEWS_COLLECTION_DEFAULT_HOURS,
  PriceColors,
  Theme,
  marketDataSourceSchema,
  newsIntervalSchema,
  priceColorsSchema,
  themeSchema,
} from "#shared/ipc/settings.ts";
import type { FubonFile } from "#shared/ipc/settings.ts";
import {
  ColorScheme,
  Palette,
  customPalettesSchema,
  hasPalette,
} from "#shared/palette.ts";
import type { CustomPalette, PaletteToken } from "#shared/palette.ts";

const PARSE_OPTIONS = { allowTrailingComma: true };

// Text that is empty or of the wrong shape reads as missing.
const textSchema = z.string().trim().min(1).optional().catch(undefined);

const paletteIdSchema = z.string().min(1).catch(Palette.Blueprint);

/** An http(s) endpoint, which a proxy on this computer may serve without TLS. */
export const endpointSchema = z.url({ protocol: /^https?$/ }).max(2048);

/** A section that is missing or of the wrong shape reads as empty, so each of its entries reads as its default. */
function section<T extends z.ZodType>(schema: T) {
  return schema.catch(() => schema.parse({}));
}

// An entry that no longer parses reads as its default, so one bad edit leaves the rest of the file
// in force. Loose objects keep keys this build does not know, so saving never drops someone's edits.
const configSchema = section(
  z.looseObject({
    appearance: section(
      z
        .looseObject({
          theme: themeSchema.catch(Theme.System),
          palette: section(
            z.looseObject({
              [ColorScheme.Light]: paletteIdSchema,
              [ColorScheme.Dark]: paletteIdSchema,
            })
          ),
          palettes: customPalettesSchema,
          priceColors: priceColorsSchema.catch(PriceColors.Market),
        })
        .transform(({ palette, ...appearance }) => {
          // A palette that is neither built in nor one of the user's reads as the default.
          const known = (id: string) =>
            hasPalette(id, appearance.palettes) ? id : Palette.Blueprint;

          return {
            ...appearance,
            palette: {
              [ColorScheme.Light]: known(palette.light),
              [ColorScheme.Dark]: known(palette.dark),
            },
          };
        })
    ),
    marketData: section(
      z.looseObject({
        TW: marketDataSourceSchema.catch(MarketDataSource.Fugle),
      })
    ),
    providers: section(
      z.looseObject({
        fugle: section(
          z.looseObject({ plan: fuglePlanSchema.catch(FuglePlan.Basic) })
        ),
        fubon: section(
          z.looseObject({ sdk: textSchema, certificate: textSchema })
        ),
      })
    ),
    agent: section(
      z.looseObject({
        provider: agentProviderSchema.catch(AgentProvider.Anthropic),
        // Model ids differ by provider, so the reader falls back to the provider's default.
        model: textSchema,
        thinking: agentThinkingSchema.catch(AgentThinking.Medium),
        auth: agentAuthSchema.catch(AgentAuth.ApiKey),
        sharedSkills: z.array(z.string()).catch([]),
        shell: z.boolean().catch(false),
        // Values are checked one by one where they are read, so one bad entry keeps the rest.
        mcpTools: z.record(z.string(), z.string()).catch({}),
      })
    ),
    news: section(
      z.looseObject({
        collectEveryHours: newsIntervalSchema.catch(
          NEWS_COLLECTION_DEFAULT_HOURS
        ),
      })
    ),
    // Missing entries read as the decisions model's defaults where they are read.
    decisions: section(
      z.looseObject({
        model: textSchema,
        baseURL: endpointSchema.optional().catch(undefined),
      })
    ),
  })
);

type Config = z.infer<typeof configSchema>;

const DEFAULTS: Config = configSchema.parse({});

/** The values the app edits; the file may hold others a person added. */
type ConfigPath =
  | ["appearance", "theme" | "priceColors"]
  | ["appearance", "palette", ColorScheme]
  | ["appearance", "palettes", string]
  | ["appearance", "palettes", string, "name"]
  | ["appearance", "palettes", string, ColorScheme, PaletteToken]
  | ["marketData", typeof Market.TW]
  | ["providers", "fugle", "plan"]
  | ["providers", "fubon", FubonFile]
  | [
      "agent",
      "provider" | "model" | "thinking" | "auth" | "sharedSkills" | "shell",
    ]
  | ["agent", "mcpTools", string]
  | ["news", "collectEveryHours"]
  | ["decisions", "model" | "baseURL"];

/** `undefined` removes the entry. */
type ConfigValue =
  | string
  | number
  | boolean
  | string[]
  | CustomPalette
  | undefined;

export type ConfigEntry = readonly [path: ConfigPath, value: ConfigValue];

const FORMATTING = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

const quoted = (values: Record<string, string>) =>
  Object.values(values)
    .map((value) => `"${value}"`)
    .join(", ");

const TEMPLATE = [
  "// Settings Solyx reads. Edit them here or on the settings page; saving this file applies them.",
  "{",
  '  "appearance": {',
  `    // Light or dark, or follow the computer: ${quoted(Theme)}.`,
  `    "theme": "${DEFAULTS.appearance.theme}",`,
  `    // The palette each appearance shows: ${quoted(Palette)}.`,
  `    "palette": { "light": "${DEFAULTS.appearance.palette.light}", "dark": "${DEFAULTS.appearance.palette.dark}" },`,
  '    // Your own palettes by id, which "palette" can name too. Each starts from a built-in one in "extends"',
  '    // and sets the colours it changes as "#rrggbb", under "light" and "dark"; the settings page copies one.',
  '    "palettes": {},',
  `    // Which colour marks a rise: ${quoted(PriceColors)}; "market" is red in Taiwan and green in the US.`,
  `    "priceColors": "${DEFAULTS.appearance.priceColors}"`,
  "  },",
  '  "marketData": {',
  `    // Where Taiwan charts come from: ${quoted(MarketDataSource)}.`,
  `    "TW": "${DEFAULTS.marketData.TW}"`,
  "  },",
  '  "providers": {',
  `    // Your key's plan: ${quoted(FuglePlan)}.`,
  `    "fugle": { "plan": "${DEFAULTS.providers.fugle.plan}" },`,
  "    // The folder extracted from Fubon's SDK download, and the certificate exported from its website.",
  '    "fubon": { "sdk": "", "certificate": "" }',
  "  },",
  '  "agent": {',
  `    // Whose models run the agent, on the key saved in the app: ${quoted(AgentProvider)}.`,
  `    "provider": "${DEFAULTS.agent.provider}",`,
  "    // The provider's model id; the settings page lists them.",
  `    "model": "${DEFAULT_MODEL[DEFAULTS.agent.provider]}",`,
  `    // How long the model thinks before it answers: ${quoted(AgentThinking)}.`,
  `    "thinking": "${DEFAULTS.agent.thinking}",`,
  `    // How the provider is paid for: ${quoted(AgentAuth)}; a subscription applies to OpenAI, signed in with ChatGPT.`,
  `    "auth": "${DEFAULTS.agent.auth}",`,
  "    // Skills from ~/.agents/skills the agent may read, by name. The skills folder beside this file is always read.",
  '    "sharedSkills": [],',
  "    // Lets the agent run shell commands on this computer, each only after you allow it. They are not sandboxed.",
  `    "shell": ${DEFAULTS.agent.shell}`,
  "  },",
  '  "news": {',
  "    // How often news is collected for each watched listing, in hours; 0 turns automatic collection off.",
  "    // Each collection uses Firecrawl credits once its key is saved, and exchange announcements only reach back a day.",
  `    "collectEveryHours": ${DEFAULTS.news.collectEveryHours}`,
  "  },",
  '  "decisions": {',
  "    // The decisions model that scores news and posts, on the key saved in the app; TypeSafe's models, such as Jev.",
  `    "model": "${TYPESAFE_DEFAULT_MODEL}",`,
  "    // Where its requests go; change it only for a proxy or a compatible endpoint.",
  `    "baseURL": "${TYPESAFE_BASE_URL}"`,
  "  }",
  "}",
  "",
].join("\n");

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return undefined;

    throw error;
  }
}

/**
 * Writes `value` at `path`, or removes the entry for `undefined`. An entry where an object should
 * stand already reads as its default, so it is replaced by the object the value needs.
 */
function edit(text: string, path: ConfigPath, value: ConfigValue): string {
  const root = parseTree(text, [], PARSE_OPTIONS);

  for (let depth = 1; root && depth < path.length; depth += 1) {
    const parent = path.slice(0, depth);
    const node = findNodeAtLocation(root, parent);

    // Missing objects are created along the way.
    if (!node) break;

    if (node.type !== "object") {
      if (value === undefined) return text;

      const nested = path
        .slice(depth)
        .reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);

      return applyEdits(text, modify(text, parent, nested, FORMATTING));
    }
  }

  return applyEdits(text, modify(text, path, value, FORMATTING));
}

/** The file's settings, or `undefined` while it has syntax errors. */
function parseConfig(text: string): Config | undefined {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, PARSE_OPTIONS);

  return errors.length > 0 ? undefined : configSchema.parse(value);
}

/**
 * Settings the main process reads, kept as JSONC for a person to edit. Every read parses the
 * file, so saved edits apply to the next request; a file with syntax errors reads as defaults
 * and is never overwritten, and the app edits values in place so comments survive.
 */
export function createConfigFile(file: string) {
  const listeners = new Set<() => void>();

  // The text listeners last heard about, so the watcher skips the app's own saves.
  let announced: string | undefined;

  function announce(text: string | undefined) {
    announced = text;

    for (const listener of listeners) listener();
  }

  function write(text: string) {
    const temporary = `${file}.tmp`;

    mkdirSync(dirname(file), { recursive: true });
    // Written aside and renamed into place, so a crash mid-write keeps the previous file.
    writeFileSync(temporary, text, { mode: 0o600 });
    renameSync(temporary, file);
  }

  /** Saves every entry in one write, so the file never holds only some of them. */
  function update(entries: readonly ConfigEntry[]) {
    const text = readText(file) ?? TEMPLATE;

    if (parseConfig(text) === undefined) {
      throw new Error(`Fix the syntax errors in ${file} before saving`);
    }

    const edited = entries.reduce(
      (current, [path, value]) => edit(current, path, value),
      text
    );

    write(edited);
    announce(edited);
  }

  return {
    file,

    /** Writes a commented template when the file does not exist yet, so there is something to edit. */
    create() {
      if (readText(file) !== undefined) return;

      write(TEMPLATE);
      announced = TEMPLATE;
    },

    /** The saved settings, with the default for every entry that is missing or no longer parses. */
    read(): Config {
      const text = readText(file);
      const saved = text === undefined ? undefined : parseConfig(text);

      return saved ?? configSchema.parse({});
    },

    set(path: ConfigPath, value: ConfigValue) {
      update([[path, value]]);
    },

    update,

    /**
     * Calls `listener` after every change: the app's own saves as they are written, and edits
     * made outside the app while `watch` runs. Listeners read what they need and compare it.
     */
    onChange(listener: () => void): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    /** Reports edits made outside the app to `onChange` shortly after they land, until the returned function stops. */
    watch(): () => void {
      mkdirSync(dirname(file), { recursive: true });
      announced ??= readText(file);

      return watchFile(file, () => {
        const text = readText(file);

        if (text !== announced) announce(text);
      });
    },
  };
}

export type ConfigFile = ReturnType<typeof createConfigFile>;
