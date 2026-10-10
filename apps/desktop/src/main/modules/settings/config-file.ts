import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isPlainObject } from "es-toolkit";
import * as z from "zod";

import {
  AgentAuth,
  DEFAULT_PROVIDER,
  AgentThinking,
  agentAuthSchema,
  agentProviderSchema,
  agentModelRefSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import type { AgentModelRef, AgentProvider } from "@solyx/agent/providers";
import {
  DecisionMode,
  MagiUnit,
  decisionModeSchema,
} from "@solyx/core/council";
import type { Market } from "@solyx/core/market";
import {
  CollectionJob,
  ScheduleKind,
  collectionPlanSchema,
} from "@solyx/core/schedule";
import type { CollectionPlan } from "@solyx/core/schedule";
import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
} from "@solyx/decisions/cloudflare";
import { OPENAI_BASE_URL, OPENAI_DEFAULT_MODEL } from "@solyx/decisions/openai";
import {
  DecisionsProvider,
  decisionsProviderSchema,
} from "@solyx/decisions/provider";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
} from "@solyx/decisions/typesafe";
import {
  EMBEDDINGS_DEFAULTS,
  EmbeddingsProvider,
  embeddingsProviderSchema,
} from "@solyx/embeddings/provider";
import { FinMindPlan, finMindPlanSchema } from "@solyx/fundamentals/finmind";
import { FuglePlan, fuglePlanSchema } from "@solyx/market-data/fugle";
import { isErrnoError } from "@solyx/utils/error";
import { watchFile } from "@solyx/utils/server";
import {
  WebSearchProvider,
  webSearchProviderSchema,
} from "@solyx/web-search/provider";

import {
  MarketDataSource,
  PriceColors,
  Theme,
  marketDataSourceSchema,
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

// Text that is empty or of the wrong shape reads as missing.
const unitModelSchema = agentModelRefSchema.nullable().catch(null);

const textSchema = z.string().trim().min(1).optional().catch(undefined);

const paletteIdSchema = z.string().min(1).catch(Palette.Blueprint);

/** An http(s) endpoint, which a proxy on this computer may serve without TLS. */
export const endpointSchema = z.url({ protocol: /^https?$/ }).max(2048);

const HOUR_MINUTES = 60;

/**
 * When each of the app's own collections runs until the user says otherwise, on this computer's
 * clock: news every three days, so a web search vendor's free tier covers a watchlist of about ten
 * listings, and themes daily, since a theme moves over weeks.
 */
export const DEFAULT_COLLECTION_PLANS: Record<CollectionJob, CollectionPlan> = {
  [CollectionJob.News]: {
    enabled: true,
    schedule: { kind: ScheduleKind.Interval, everyMinutes: 72 * HOUR_MINUTES },
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  [CollectionJob.Themes]: {
    enabled: true,
    schedule: { kind: ScheduleKind.Interval, everyMinutes: 24 * HOUR_MINUTES },
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
};

/** A section that is missing or of the wrong shape reads as empty, so each of its entries reads as its default. */
function section<T extends z.ZodType>(schema: T) {
  return schema.catch(() => schema.parse({}));
}

// An entry that no longer parses reads as its default, so one bad edit leaves the rest of the file
// in force. Loose objects keep keys this build does not know, so saving never drops someone's edits.
// Descriptions document each entry in the JSON Schema an editor checks the file against.
const configSchema = section(
  z.looseObject({
    appearance: section(
      z
        .looseObject({
          theme: themeSchema
            .catch(Theme.System)
            .meta({ description: "Light or dark, or follow the computer." }),
          palette: section(
            z.looseObject({
              [ColorScheme.Light]: paletteIdSchema,
              [ColorScheme.Dark]: paletteIdSchema,
            })
          ).meta({
            description:
              'The palette each appearance shows, built in or an id from "palettes".',
          }),
          palettes: customPalettesSchema.meta({
            description:
              'Your own palettes by id. Each starts from a built-in one in "extends" and sets the colours it changes as "#rrggbb", under "light" and "dark"; the settings page copies one.',
          }),
          priceColors: priceColorsSchema.catch(PriceColors.Market).meta({
            description:
              'Which colour marks a rise; "market" is red in Taiwan and green in the US.',
          }),
        })
        .transform((appearance) => {
          // A palette that is neither built in nor one of the user's reads as the default.
          const known = (id: string) =>
            hasPalette(id, appearance.palettes) ? id : Palette.Blueprint;

          return {
            ...appearance,
            palette: {
              [ColorScheme.Light]: known(appearance.palette.light),
              [ColorScheme.Dark]: known(appearance.palette.dark),
            },
          };
        })
    ),
    marketData: section(
      z.looseObject({
        TW: marketDataSourceSchema
          .catch(MarketDataSource.Fugle)
          .meta({ description: "Where Taiwan charts come from." }),
      })
    ),
    providers: section(
      z.looseObject({
        fugle: section(
          z.looseObject({
            plan: fuglePlanSchema
              .catch(FuglePlan.Basic)
              .meta({ description: "Your Fugle key's plan." }),
          })
        ),
        finmind: section(
          z.looseObject({
            plan: finMindPlanSchema
              .catch(FinMindPlan.Free)
              .meta({ description: "Your FinMind token's plan." }),
          })
        ),
        fubon: section(
          z.looseObject({
            sdk: textSchema.meta({
              description: "The folder extracted from Fubon's SDK download.",
            }),
            certificate: textSchema.meta({
              description: "The certificate exported from Fubon's website.",
            }),
          })
        ),
      })
    ),
    agent: section(
      z.looseObject({
        // The default model's provider is always among them, listed or not; an id the app does
        // not offer is ignored where it is read, so one stale entry keeps the rest.
        providers: z.array(z.string()).catch([]).meta({
          description:
            "The providers whose models a conversation may pick, by id, each on the key saved in the app; the settings page lists them.",
        }),
        provider: agentProviderSchema.catch(DEFAULT_PROVIDER).meta({
          description:
            "The provider new conversations start on, which is always switched on.",
        }),
        // Model ids differ by provider, so the reader falls back to the provider's default.
        model: textSchema.meta({
          description:
            "The provider's model new conversations start on, by id, or its default when missing; the settings page lists them.",
        }),
        thinking: agentThinkingSchema.catch(AgentThinking.Medium).meta({
          description: "How long the model thinks before it answers.",
        }),
        auth: agentAuthSchema.catch(AgentAuth.ApiKey).meta({
          description:
            "How the provider is paid for; a subscription applies to OpenAI, signed in with ChatGPT.",
        }),
        // By provider id; an entry that is not an endpoint reads as the provider's own.
        endpoints: z
          .record(z.string(), endpointSchema.optional().catch(undefined))
          .catch({})
          .meta({
            description:
              "Where a provider's requests go in place of its own endpoint, by provider, such as a gateway that speaks its API; your key is sent there. OpenAI's applies only on an API key, and OpenRouter, whose models use several, takes none.",
          }),
        sharedSkills: z.array(z.string()).catch([]).meta({
          description:
            "Skills from ~/.agents/skills the agent may read, by name. The skills folder beside this file is always read.",
        }),
        shell: z.boolean().catch(false).meta({
          description:
            "Lets the agent run shell commands on this computer, each only after you allow it. They are not sandboxed.",
        }),
        decisionMode: decisionModeSchema.catch(DecisionMode.Single).meta({
          description:
            "Who decides the agent's forecasts and order proposals: the agent alone, or the MAGI, three units that each vote on them as one side of a mind, at the cost of three more requests to the model each time.",
        }),
        // One model each, or null for the model of the conversation that put the motion.
        magi: z
          .object({
            [MagiUnit.Melchior]: unitModelSchema,
            [MagiUnit.Balthasar]: unitModelSchema,
            [MagiUnit.Casper]: unitModelSchema,
          })
          .catch({
            [MagiUnit.Melchior]: null,
            [MagiUnit.Balthasar]: null,
            [MagiUnit.Casper]: null,
          })
          .meta({
            description:
              "The model each MAGI unit answers on, by provider and model id; a unit without one answers on the conversation's model.",
          }),
        memory: z.boolean().catch(true).meta({
          description:
            "Lets the agent read what it kept from earlier conversations and ask to save, rewrite or forget a memory; each change waits for you to allow it.",
        }),
        // Values are checked one by one where they are read, so one bad entry keeps the rest.
        mcpTools: z.record(z.string(), z.string()).catch({}).meta({
          description:
            'Whether each MCP tool is off, asks first or runs on its own, by "server/tool"; the settings page sets them.',
        }),
      })
    ),
    collection: section(
      z.looseObject({
        [CollectionJob.News]: collectionPlanSchema
          .catch(DEFAULT_COLLECTION_PLANS[CollectionJob.News])
          .meta({
            description:
              "When news is collected for each listing you hold or watch while Solyx runs: every so many minutes, or at a time of day on timeZone's clock, which may keep to the days a market trades. Each collection spends the web search vendor's credits once its key is saved, and exchange announcements only reach back a day.",
          }),
        [CollectionJob.Themes]: collectionPlanSchema
          .catch(DEFAULT_COLLECTION_PLANS[CollectionJob.Themes])
          .meta({
            description:
              "When each theme's queries are searched for news while Solyx runs, timed as news collection is. Each query is one search on the web search vendor's key, and each item found is read against the theme's signposts by the decisions model.",
          }),
      })
    ),
    updates: section(
      z.looseObject({
        check: z.boolean().catch(true).meta({
          description:
            "Asks download.usesolyx.trade for a newer Solyx a minute after it starts and every six hours. On Windows the update downloads and installs when you restart; on macOS it is linked for you to download.",
        }),
      })
    ),
    otlp: section(
      z.looseObject({
        endpoint: endpointSchema.optional().catch(undefined).meta({
          description:
            "The OpenTelemetry endpoint Solyx sends traces and logs to over OTLP/HTTP, as OTEL_EXPORTER_OTLP_ENDPOINT names it, such as Grafana Cloud's OTLP gateway or a collector on this computer: traces go to its /v1/traces and logs to its /v1/logs. Each agent run is a trace of its model requests and tool calls, with models, token counts and timings but never what the conversation says, and each pass of scheduled work is one too. Each failure the app recovers from or did not expect is a log of what failed and its kind, never the message a provider sent. Headers it needs, such as Grafana Cloud's authorization, are saved in the app as a secret. Unset sends nothing.",
        }),
      })
    ),
    crashReports: section(
      z.looseObject({
        send: z.boolean().catch(false).meta({
          description:
            "Sends Solyx's maintainer a report through Sentry when Solyx crashes or hits an error it did not expect: what went wrong, where in the code, and the versions of Solyx, Electron and the operating system. Reports leave out your keys, conversations, holdings and orders.",
        }),
      })
    ),
    webSearch: section(
      z.looseObject({
        provider: webSearchProviderSchema
          .catch(WebSearchProvider.Firecrawl)
          .meta({
            description:
              "Whose web search finds news articles and social posts and serves the agent's web searches and page reads, on the key saved in the app for it: Firecrawl, which searches Google, Exa's own index, or Tavily's.",
          }),
      })
    ),
    // A missing model or endpoint reads as the provider's default where it is read.
    decisions: section(
      z.looseObject({
        provider: decisionsProviderSchema
          .catch(DecisionsProvider.TypeSafe)
          .meta({
            description:
              "Whose decisions model scores news and posts, on the key saved in the app for it: TypeSafe's models, such as Jev, Cloudflare's Clef on Workers AI, or OpenAI's Luna.",
          }),
        typesafe: section(
          z.looseObject({
            model: textSchema.meta({
              description: "The id of TypeSafe's model.",
              default: TYPESAFE_DEFAULT_MODEL,
            }),
            baseURL: endpointSchema.optional().catch(undefined).meta({
              description:
                "Where requests to TypeSafe go; change it only for a proxy or a compatible endpoint.",
              default: TYPESAFE_BASE_URL,
            }),
          })
        ),
        cloudflare: section(
          z.looseObject({
            accountId: textSchema.meta({
              description:
                "The Cloudflare account whose Workers AI runs the model.",
            }),
            model: textSchema.meta({
              description: "The id of Cloudflare's model: clef or clef-flash.",
              default: CLOUDFLARE_DEFAULT_MODEL,
            }),
            baseURL: endpointSchema.optional().catch(undefined).meta({
              description:
                "Where requests to Cloudflare go; change it only for a proxy or a gateway.",
              default: CLOUDFLARE_BASE_URL,
            }),
          })
        ),
        openai: section(
          z.looseObject({
            model: textSchema.meta({
              description: "The id of OpenAI's decisions model.",
              default: OPENAI_DEFAULT_MODEL,
            }),
            baseURL: endpointSchema.optional().catch(undefined).meta({
              description:
                "Where requests to OpenAI go; change it only for a proxy or a gateway.",
              default: OPENAI_BASE_URL,
            }),
          })
        ),
      })
    ),
    // A missing model or endpoint reads as the provider's default where it is read.
    embeddings: section(
      z.looseObject({
        enabled: z.boolean().catch(false).meta({
          description:
            "Experimental: news also counts items two sites published on one day as one story when their vectors read alike, which catches a story reworded too far for its titles to match. Off, stories are told apart by their titles alone.",
        }),
        provider: embeddingsProviderSchema
          .catch(EmbeddingsProvider.Local)
          .meta({
            description:
              "Where vectors come from: a model on this computer through Ollama, which sends nothing off it, or OpenAI's, on the key saved in the app for it, which is sent each item's title and the start of its snippet. Only a model a line was measured on joins stories.",
          }),
        local: section(
          z.looseObject({
            model: textSchema.meta({
              description:
                "The model Ollama runs, pulled first with `ollama pull`.",
              default: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.Local].model,
            }),
            baseURL: endpointSchema.optional().catch(undefined).meta({
              description:
                "Where Ollama, or another server that speaks OpenAI's embeddings API, listens.",
              default: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.Local].baseURL,
            }),
          })
        ),
        openai: section(
          z.looseObject({
            model: textSchema.meta({
              description: "The id of OpenAI's embedding model.",
              default: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.OpenAI].model,
            }),
            baseURL: endpointSchema.optional().catch(undefined).meta({
              description:
                "Where requests to OpenAI go; change it only for a proxy or a gateway.",
              default: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.OpenAI].baseURL,
            }),
          })
        ),
      })
    ),
  })
).meta({
  title: "Solyx settings",
  description:
    "Settings Solyx reads. Edit them here or on the settings page; saving this file applies them.",
});

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
  | ["providers", "fugle" | "finmind", "plan"]
  | ["providers", "fubon", FubonFile]
  | [
      "agent",
      (
        | "providers"
        | "provider"
        | "model"
        | "thinking"
        | "auth"
        | "sharedSkills"
        | "shell"
        | "decisionMode"
        | "memory"
      ),
    ]
  | ["agent", "endpoints", AgentProvider]
  | ["agent", "magi", MagiUnit]
  | ["agent", "mcpTools", string]
  | ["collection", CollectionJob]
  | ["updates", "check"]
  | ["crashReports", "send"]
  | ["otlp", "endpoint"]
  | ["webSearch", "provider"]
  | ["decisions", "provider"]
  | ["decisions", DecisionsProvider, "model" | "baseURL"]
  | ["decisions", typeof DecisionsProvider.Cloudflare, "accountId"]
  | ["embeddings", "enabled" | "provider"];

/** `undefined` removes the entry. */
type ConfigValue =
  | string
  | number
  | boolean
  | string[]
  | CustomPalette
  | AgentModelRef
  | CollectionPlan
  | null
  | undefined;

export type ConfigEntry = readonly [path: ConfigPath, value: ConfigValue];

/** The file's entries as written, so saving keeps the ones the app does not read. */
const savedSchema = z.record(z.string(), z.json());

interface Saved {
  [key: string]: SavedValue;
}

type SavedValue = z.infer<typeof savedSchema>[string] | ConfigValue | Saved;

const isSaved = (value: SavedValue): value is Saved => isPlainObject(value);

/** Named by the template's `$schema` and written beside the file. */
const SCHEMA_FILE = "config.schema.json";

const serialize = (value: Saved | Config | z.core.JSONSchema.JSONSchema) =>
  `${JSON.stringify(value, null, 2)}\n`;

// Generated from the schema the app reads with, so editors check the file against the same rules.
const jsonSchema = z.toJSONSchema(configSchema, {
  io: "input",
  target: "draft-07",
  // Every entry reads as its default when missing, so none is required.
  override: ({ jsonSchema }) => {
    delete jsonSchema.required;
  },
});

const JSON_SCHEMA = serialize(jsonSchema);

/** An entry of the JSON Schema with only what describes it and the entries beneath it. */
const describedSchema = z.object({
  description: z.string().optional(),
  get properties(): z.ZodOptional<
    z.ZodRecord<z.ZodString, typeof describedSchema>
  > {
    return z.record(z.string(), describedSchema).optional();
  },
});

type Described = z.infer<typeof describedSchema>;

const DESCRIBED = describedSchema.parse(jsonSchema);

/** What the JSON Schema says of the entry at `path`, as an editor shows it beside the file. */
export function entryDescription(path: readonly string[]): string | undefined {
  let entry: Described | undefined = DESCRIBED;

  for (const key of path) entry = entry?.properties?.[key];

  return entry?.description;
}

const TEMPLATE = serialize({
  $schema: `./${SCHEMA_FILE}`,
  ...DEFAULTS,
  decisions: {
    ...DEFAULTS.decisions,
    typesafe: { model: TYPESAFE_DEFAULT_MODEL, baseURL: TYPESAFE_BASE_URL },
    cloudflare: {
      model: CLOUDFLARE_DEFAULT_MODEL,
      baseURL: CLOUDFLARE_BASE_URL,
    },
    openai: { model: OPENAI_DEFAULT_MODEL, baseURL: OPENAI_BASE_URL },
  },
  embeddings: {
    ...DEFAULTS.embeddings,
    local: {
      model: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.Local].model,
      baseURL: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.Local].baseURL,
    },
    openai: {
      model: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.OpenAI].model,
      baseURL: EMBEDDINGS_DEFAULTS[EmbeddingsProvider.OpenAI].baseURL,
    },
  },
});

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return undefined;

    throw error;
  }
}

/** The file's entries, or `undefined` while it has syntax errors; a file that is not an object holds none. */
function parseSaved(text: string): Saved | undefined {
  try {
    return savedSchema.catch({}).parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Writes `value` at `path` in `saved`, or removes the entry for `undefined`. An entry where an
 * object should stand already reads as its default, so it is replaced by the object the value needs.
 */
function edit(
  saved: Saved,
  [key, ...rest]: readonly string[],
  value: ConfigValue
) {
  if (rest.length === 0) {
    if (value === undefined) delete saved[key];
    else saved[key] = value;

    return;
  }

  let entry = saved[key];

  if (entry === undefined || !isSaved(entry)) {
    // Nothing beneath an entry that is not an object can be removed.
    if (value === undefined) return;

    entry = {};
    saved[key] = entry;
  }

  edit(entry, rest, value);
}

/**
 * Settings the main process reads, kept as JSON for a person to edit beside the JSON Schema that
 * documents them. Every read parses the file, so saved edits apply to the next request; a file
 * with syntax errors reads as defaults and is never overwritten.
 */
export function createConfigFile(file: string) {
  const schemaFile = join(dirname(file), SCHEMA_FILE);
  const listeners = new Set<() => void>();

  // The text listeners last heard about, so the watcher skips the app's own saves.
  let announced: string | undefined;

  function announce(text: string | undefined) {
    announced = text;

    for (const listener of listeners) listener();
  }

  function write(path: string, text: string) {
    const temporary = `${path}.tmp`;

    mkdirSync(dirname(path), { recursive: true });
    // Written aside and renamed into place, so a crash mid-write keeps the previous file.
    writeFileSync(temporary, text, { mode: 0o600 });
    renameSync(temporary, path);
  }

  /** Saves every entry in one write, so the file never holds only some of them. */
  function update(entries: readonly ConfigEntry[]) {
    const saved = parseSaved(readText(file) ?? TEMPLATE);

    if (saved === undefined) {
      throw new Error(`Fix the syntax errors in ${file} before saving`);
    }

    for (const [path, value] of entries) edit(saved, path, value);

    const text = serialize(saved);

    write(file, text);
    announce(text);
  }

  return {
    file,

    /**
     * Writes this build's schema, and a template when the file does not exist yet, so there is
     * something to edit.
     */
    create() {
      if (readText(schemaFile) !== JSON_SCHEMA) write(schemaFile, JSON_SCHEMA);

      if (readText(file) !== undefined) return;

      write(file, TEMPLATE);
      announced = TEMPLATE;
    },

    /** The saved settings, with the default for every entry that is missing or no longer parses. */
    read(): Config {
      const text = readText(file);

      return configSchema.parse(
        text === undefined ? undefined : parseSaved(text)
      );
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
