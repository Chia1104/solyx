import * as z from "zod";

import { McpServerState } from "@solyx/agent/mcp-config";
import { AgentThinking } from "@solyx/agent/providers";
import type { SetupArea, SetupPort, SetupSetting } from "@solyx/agent/setup";
import { SkillSource } from "@solyx/agent/skill-source";
import type { SkillCatalog } from "@solyx/agent/skills";
import type { SettingChange } from "@solyx/agent/wire";
import { DecisionMode } from "@solyx/core/council";
import { Market } from "@solyx/core/market";
import type { MemoryStore } from "@solyx/core/memory";
import { CollectionJob, ScheduleKind } from "@solyx/core/schedule";
import type { Schedule, ScheduleStore } from "@solyx/core/schedule";
import type { ThemeStore } from "@solyx/core/theme";
import { DecisionsProvider } from "@solyx/decisions/provider";
import { EmbeddingsProvider } from "@solyx/embeddings/provider";
import { FinMindPlan } from "@solyx/fundamentals/finmind";
import { FuglePlan } from "@solyx/market-data/fugle";
import { WebSearchProvider } from "@solyx/web-search/provider";

import {
  DECISIONS_SECRETS,
  FubonFile,
  FubonSessionState,
  LanguagePreference,
  MarketDataSource,
  PriceColors,
  Secret,
  SecretState,
  Theme,
  isDecisionsReady,
  isMarketDataReady,
  isWebSearchReady,
  mcpSecretKey,
  timeZonePreferenceSchema,
} from "#shared/ipc/settings.ts";
import { ColorScheme, Palette } from "#shared/palette.ts";
import { SettingsSection, settingsLink } from "#shared/settings-section.ts";

import type { Decisions } from "../decisions/decisions.ts";
import type { Embeddings } from "../embeddings/embeddings.ts";
import type { MarketDataModule } from "../market/market-data.ts";
import type { AppearanceSettings } from "../settings/appearance.ts";
import { entryDescription } from "../settings/config-file.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import type { WebSearchModule } from "../web-search/web-search.ts";

import type { AgentModels } from "./agent-models.ts";
import type { McpServers } from "./mcp-servers.ts";

/** What the agent's setup reads beyond what the agent itself holds. */
export interface AgentSetupSources {
  appearance: Pick<
    AppearanceSettings,
    | "read"
    | "setTheme"
    | "setPalette"
    | "setPriceColors"
    | "setLanguage"
    | "setTimeZone"
  >;
  marketData: Pick<MarketDataModule, "status">;
  webSearch: Pick<WebSearchModule, "settings">;
  decisions: Pick<Decisions, "settings">;
  embeddings: Pick<Embeddings, "settings">;
  /** The scheduled tasks the user wrote, which only they change. */
  schedules: Pick<ScheduleStore, "list">;
  /** The themes the app watches for the user. */
  themes: Pick<ThemeStore, "list">;
  version: string;
  /** Paths are shown with it as `~`. */
  home: string;
}

export interface AgentSetupOptions extends AgentSetupSources {
  config: ConfigFile;
  secrets: Pick<SecretStore, "available" | "states" | "saved">;
  models: Pick<AgentModels, "settings" | "setDefaultProvider">;
  mcp: Pick<McpServers, "file" | "status">;
  skills: () => Promise<SkillCatalog>;
  instructions: () => Promise<string | undefined>;
  memory: Pick<MemoryStore, "list">;
  /** Whether the agent has the shell now, which it never has beside a live account. */
  shellOn: () => boolean;
  files: { config: string; skills: string; instructions: string };
}

/** A config file entry by its path, described as the JSON Schema beside the file describes it. */
function entry(path: string[], value: string): SetupSetting {
  return {
    name: path.join("."),
    value,
    description: entryDescription(path),
  };
}

const stateText = (state: SecretState) =>
  state === SecretState.Unreadable
    ? "saved, but no longer readable on this computer; save it again"
    : state;

const onOff = (on: boolean) => (on ? "on" : "off");

/** A setting the agent may change once the user allows it. */
interface Changeable {
  /** What it takes, worded for the model. */
  accepts: string;
  /** What saves `value`, or `undefined` where the setting does not take it. */
  parse(value: string): (() => Promise<void>) | undefined;
}

// More would crowd get_setup's answer; a gateway lists hundreds of models.
const LISTED_MODELS = 30;

const oneOf = (values: readonly string[]) => `one of ${values.join(", ")}`;

/** A setting that takes one of `values`. */
function choice<T extends string>(
  values: readonly T[],
  save: (value: T) => void | Promise<void>,
  accepts = oneOf(values)
): Changeable {
  return {
    accepts,
    parse(value) {
      const found = values.find((each) => each === value);

      return found === undefined
        ? undefined
        : async () => {
            await save(found);
          };
    },
  };
}

/** A setting that is on or off, as true or false. */
const flag = (save: (on: boolean) => void) =>
  choice(["true", "false"], (value) => save(value === "true"));

const HOUR_MINUTES = 60;

// A span between collections as the agent may set it, in whole hours, up to a week.
const hoursSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1)
      .max(7 * 24)
  );

/** The settings page's tabs as the agent reads them, with what keeps each from working. */
export function createAgentSetup(options: AgentSetupOptions): SetupPort {
  const { config, secrets } = options;
  const tildify = (path: string) => path.replace(options.home, "~");

  function appearance(): SetupArea {
    const { theme, palette, palettes, priceColors, language, timeZone } =
      options.appearance.read();

    const tray = config.read().tray;

    const paletteName = (id: string) =>
      palettes[id] ? `${id} (the user's own "${palettes[id].name}")` : id;

    return {
      name: "General",
      link: settingsLink(SettingsSection.General),
      missing: [],
      settings: [
        entry(["appearance", "theme"], theme),
        ...Object.values(ColorScheme).map((scheme) => ({
          name: `appearance.palette.${scheme}`,
          value: paletteName(palette[scheme]),
          description: entryDescription(["appearance", "palette"]),
        })),
        entry(["appearance", "priceColors"], priceColors),
        entry(["appearance", "language"], language),
        entry(["appearance", "timeZone"], timeZone),
        entry(["tray", "show"], String(tray.show)),
        entry(["tray", "hideDock"], String(tray.hideDock)),
      ],
    };
  }

  async function marketData(): Promise<SetupArea> {
    const [status, states] = await Promise.all([
      options.marketData.status(),
      secrets.states(),
    ]);

    const source = status.markets[Market.TW]?.source ?? MarketDataSource.Fugle;
    const { fubon } = status;
    const missing: string[] = [];

    if (!isMarketDataReady(status)) {
      const needs =
        source === MarketDataSource.Fubon
          ? [
              ...(fubon.files[FubonFile.Sdk] ? [] : ["the SDK folder"]),
              ...(fubon.files[FubonFile.Certificate]
                ? []
                : ["the certificate"]),
              ...(states[Secret.FubonPersonalId] === SecretState.Saved
                ? []
                : ["the ID number"]),
              ...(states[Secret.FubonApiKey] === SecretState.Saved
                ? []
                : ["the API key"]),
            ].join(", ")
          : "a Fugle API key";

      missing.push(
        `Taiwan's charts, quotes and news have no source: ${source} still needs ${needs}.`
      );
    }

    if (
      source === MarketDataSource.Fubon &&
      fubon.session.state === FubonSessionState.Failed
    ) {
      missing.push(
        `Fubon's sign-in failed: ${fubon.session.message}. It is not tried again until its settings change or the user signs in again on this tab, since repeated failures could lock the account.`
      );
    }

    const session =
      fubon.session.state === FubonSessionState.SignedIn
        ? `signed in, ${fubon.session.accounts} accounts`
        : fubon.session.state;

    return {
      name: "Market data",
      link: settingsLink(SettingsSection.MarketData),
      missing,
      settings: [
        entry(["marketData", Market.TW], source),
        {
          name: "US market data",
          value: "no source in the app covers it yet",
        },
        { name: "Fugle API key", value: stateText(states[Secret.FugleApiKey]) },
        entry(["providers", "fugle", "plan"], status.fugle.plan),
        entry(
          ["providers", "fubon", FubonFile.Sdk],
          fubon.files[FubonFile.Sdk] ? "chosen" : "not chosen"
        ),
        entry(
          ["providers", "fubon", FubonFile.Certificate],
          fubon.files[FubonFile.Certificate] ? "chosen" : "not chosen"
        ),
        {
          name: "Fubon ID number",
          value: stateText(states[Secret.FubonPersonalId]),
        },
        { name: "Fubon API key", value: stateText(states[Secret.FubonApiKey]) },
        {
          name: "Fubon certificate password",
          value: stateText(states[Secret.FubonCertPassword]),
          description: "Optional: without it, the ID number is tried.",
        },
        { name: "Fubon sign-in", value: session },
        {
          name: "FinMind token",
          value: stateText(states[Secret.FinMindToken]),
          description:
            "Optional: FinMind serves fundamentals, investor flows and trading days without one, under a lower limit.",
        },
        entry(
          ["providers", "finmind", "plan"],
          config.read().providers.finmind.plan
        ),
      ],
    };
  }

  async function agent(): Promise<SetupArea[]> {
    const [models, webSearch, states] = await Promise.all([
      options.models.settings(),
      options.webSearch.settings(),
      secrets.states(),
    ]);

    const decisions = options.decisions.settings();
    const embeddings = options.embeddings.settings();
    const link = settingsLink(SettingsSection.Agent);

    const providerText = models.providers
      .filter((each) => each.listed)
      .map((each) => {
        const access = each.subscription?.signedIn
          ? "subscription signed in"
          : `key ${stateText(each.key)}`;

        const endpoint =
          each.endpoint && each.endpoint.url !== each.endpoint.default
            ? `, requests to ${each.endpoint.url}`
            : "";

        return `${each.provider} (${onOff(each.enabled)}, ${access}${endpoint})`;
      });

    const unlisted = models.providers
      .filter((each) => !each.listed)
      .map((each) => each.provider);

    const defaultModel = models.models.find(
      (each) => each.provider === models.provider && each.id === models.model
    );

    const defaultUsable = models.providers.some(
      (each) => each.provider === models.provider && each.usable
    );

    const magi = Object.entries(models.magi)
      .map(
        ([unit, model]) =>
          `${unit} ${model ? `${model.provider}/${model.id}` : "the conversation's model"}`
      )
      .join(", ");

    const secretsStatus = { available: await secrets.available(), states };

    const decisionsProvider = decisions.providers.find(
      (each) => each.provider === decisions.provider
    );

    const embeddingsMissing = embeddings.enabled
      ? [
          ...(embeddings.provider === EmbeddingsProvider.OpenAI &&
          states[Secret.EmbeddingsApiKey] !== SecretState.Saved
            ? ["OpenAI's embeddings have no key saved, so no vectors are made."]
            : []),
          ...(embeddings.measured
            ? []
            : [
                `No line was measured on ${embeddings.space}, so its vectors join no stories.`,
              ]),
        ]
      : [];

    return [
      {
        name: "Agent models",
        link,
        missing: [
          ...(models.ready
            ? []
            : [
                "No provider switched on has a key saved or a subscription signed in, so the agent cannot run.",
              ]),
          ...(models.ready && !defaultUsable
            ? [
                `The default model's provider, ${models.provider}, has no key saved or subscription signed in, so a conversation on it cannot run.`,
              ]
            : []),
        ],
        settings: [
          {
            name: "agent.providers",
            value:
              providerText.length > 0
                ? providerText.join("; ")
                : "none switched on",
            description: entryDescription(["agent", "providers"]),
          },
          {
            name: "providers the app also offers",
            value: unlisted.join(", ") || "none",
          },
          entry(["agent", "provider"], models.provider),
          entry(
            ["agent", "model"],
            defaultModel ? `${defaultModel.id} (${defaultModel.name})` : "none"
          ),
          entry(["agent", "thinking"], models.thinking),
          entry(["agent", "decisionMode"], models.decisionMode),
          ...(models.decisionMode === DecisionMode.Magi
            ? [entry(["agent", "magi"], magi)]
            : []),
        ],
      },
      {
        name: "Web search",
        link,
        missing: isWebSearchReady(webSearch)
          ? []
          : [
              `${webSearch.provider} has no key saved, so you have no web_search or read_page, and news searches only its sources that need no key.`,
            ],
        settings: [
          entry(["webSearch", "provider"], webSearch.provider),
          ...Object.entries(webSearch.keys).map(([vendor, state]) => ({
            name: `${vendor} key`,
            value: stateText(state),
          })),
        ],
      },
      {
        name: "Decisions model",
        link,
        missing: isDecisionsReady(decisions, secretsStatus)
          ? []
          : [
              `${decisions.provider} is not set up, so news goes unscored, research claims go unchecked and the auto approval mode asks about every shell command.`,
            ],
        settings: [
          entry(["decisions", "provider"], decisions.provider),
          ...(decisionsProvider
            ? [
                entry(
                  ["decisions", decisionsProvider.provider, "model"],
                  decisionsProvider.model
                ),
                {
                  name: `${decisionsProvider.provider} key`,
                  value: stateText(
                    states[DECISIONS_SECRETS[decisionsProvider.provider]]
                  ),
                },
              ]
            : []),
          ...(decisions.provider === DecisionsProvider.Cloudflare
            ? [
                entry(
                  ["decisions", "cloudflare", "accountId"],
                  decisionsProvider?.accountId ? "set" : "not set"
                ),
              ]
            : []),
        ],
      },
      {
        name: "Embeddings",
        link,
        missing: embeddingsMissing,
        settings: [
          entry(["embeddings", "enabled"], String(embeddings.enabled)),
          entry(["embeddings", "provider"], embeddings.provider),
          { name: "embedding model", value: embeddings.space },
        ],
      },
    ];
  }

  async function skills(): Promise<SetupArea> {
    const [catalog, instructions] = await Promise.all([
      options.skills(),
      options.instructions(),
    ]);

    const shell = config.read().agent.shell;

    return {
      name: "Skills",
      link: settingsLink(SettingsSection.Skills),
      missing: catalog.warnings.map(tildify),
      settings: [
        {
          name: "the user's own skills",
          value:
            catalog.skills
              .filter((skill) => skill.source === SkillSource.Solyx)
              .map((skill) => skill.name)
              .join(", ") || "none",
        },
        entry(
          ["agent", "sharedSkills"],
          config.read().agent.sharedSkills.join(", ") || "none"
        ),
        {
          name: "AGENTS.md",
          value: instructions
            ? `${instructions.length} characters`
            : "none written",
        },
        entry(
          ["agent", "shell"],
          shell && !options.shellOn()
            ? "true, but kept off while the account is live"
            : String(shell)
        ),
      ],
    };
  }

  function memory(): SetupArea {
    return {
      name: "Memory",
      link: settingsLink(SettingsSection.Memory),
      missing: [],
      settings: [
        entry(["agent", "memory"], String(config.read().agent.memory)),
        {
          name: "memories kept",
          value: String(options.memory.list().length),
        },
      ],
    };
  }

  /** When a scheduled task runs, in words. */
  function when(schedule: Schedule, timeZone: string): string {
    switch (schedule.kind) {
      case ScheduleKind.Interval:
        return `every ${schedule.everyMinutes} minutes`;
      case ScheduleKind.FixedTime:
        return `at ${schedule.time} ${timeZone}${schedule.tradingDaysOf === null ? "" : ` on days ${schedule.tradingDaysOf} trades`}`;
      case ScheduleKind.OnChange:
        return `when something the app watches changed, at most every ${schedule.atMostEveryMinutes} minutes`;
    }
  }

  function schedules(): SetupArea {
    const tasks = options.schedules.list();
    const plans = config.read().collection;

    return {
      name: "Schedules",
      link: settingsLink(SettingsSection.Schedules),
      missing: [],
      settings: [
        ...Object.values(CollectionJob).map((job) =>
          entry(
            ["collection", job],
            `${when(plans[job].schedule, plans[job].timeZone)}, ${onOff(plans[job].enabled)}`
          )
        ),
        ...(tasks.length === 0
          ? [{ name: "tasks for the agent", value: "none written" }]
          : tasks.map(({ name, schedule, timeZone, approval, enabled }) => ({
              name: `task "${name}"`,
              value: [
                when(schedule, timeZone),
                onOff(enabled),
                `calls that must ask: ${approval}`,
              ].join(", "),
            }))),
      ],
    };
  }

  function themes(): SetupArea {
    const watched = options.themes.list();

    return {
      name: "Themes",
      link: settingsLink(SettingsSection.Themes),
      missing: [],
      settings: [
        {
          name: "themes watched",
          value: watched.map(({ title }) => title).join("; ") || "none",
        },
      ],
    };
  }

  async function mcp(): Promise<SetupArea> {
    const [{ error, servers }, saved] = await Promise.all([
      options.mcp.status(),
      secrets.saved(),
    ]);

    const missing = [
      ...(error ? [`mcp.json does not parse: ${error}`] : []),
      ...servers.flatMap((server) => {
        const unsaved = server.secrets.filter(
          (name) => !saved.includes(mcpSecretKey(name))
        );

        return [
          ...(unsaved.length > 0
            ? [`${server.name} needs the secrets ${unsaved.join(", ")} saved.`]
            : []),
          ...(server.state === McpServerState.NeedsSignIn
            ? [`${server.name} waits for the user to sign in to it.`]
            : []),
          ...(server.state === McpServerState.Failed
            ? [
                `${server.name} failed to connect: ${server.error ?? "no reason given"}`,
              ]
            : []),
        ];
      }),
    ];

    return {
      name: "MCP servers",
      link: settingsLink(SettingsSection.Mcp),
      missing,
      settings:
        servers.length > 0
          ? servers.map((server) => ({
              name: server.name,
              value: `${server.state}, ${server.tools.length} tools`,
            }))
          : [{ name: "servers", value: "none in mcp.json" }],
    };
  }

  function about(): SetupArea {
    return {
      name: "About",
      link: settingsLink(SettingsSection.About),
      missing: [],
      settings: [
        { name: "version", value: options.version },
        entry(["updates", "check"], String(config.read().updates.check)),
        { name: "config file", value: tildify(options.files.config) },
        { name: "skills folder", value: tildify(options.files.skills) },
        {
          name: "standing instructions",
          value: tildify(options.files.instructions),
        },
        { name: "mcp.json", value: tildify(options.mcp.file) },
      ],
    };
  }

  /**
   * The settings the agent may change, through the writers the settings page uses. A key, a
   * sign-in, a provider switched on, an endpoint, the shell, MCP tools, shared skills, memory and
   * the tray stay the user's alone, since each would widen what the agent reaches.
   */
  async function changeables(): Promise<Map<string, Changeable>> {
    const models = await options.models.settings();
    const { palettes } = options.appearance.read();

    const usable = models.providers
      .filter((each) => each.usable)
      .map((each) => each.provider);

    const modelIds = models.models
      .filter((each) => each.provider === models.provider)
      .map((each) => each.id);

    const paletteIds = [...Object.values(Palette), ...Object.keys(palettes)];

    /** Switches one of the app's collections on or off, or has it run every so many hours; a time of day stays the user's to set. */
    const collection = (job: CollectionJob): Changeable => ({
      accepts:
        "off, on, or a whole number of hours from 1 to 168 between collections, which also switches it on",
      parse(value) {
        const plan = config.read().collection[job];
        const hours = hoursSchema.safeParse(value);

        if (value === "off" || value === "on") {
          return async () =>
            config.set(["collection", job], {
              ...plan,
              enabled: value === "on",
            });
        }

        return hours.success
          ? async () =>
              config.set(["collection", job], {
                ...plan,
                enabled: true,
                schedule: {
                  kind: ScheduleKind.Interval,
                  everyMinutes: hours.data * HOUR_MINUTES,
                },
              })
          : undefined;
      },
    });

    return new Map([
      [
        "appearance.theme",
        choice(Object.values(Theme), (theme) =>
          options.appearance.setTheme(theme)
        ),
      ],
      ...Object.values(ColorScheme).map(
        (scheme) =>
          [
            `appearance.palette.${scheme}`,
            choice(paletteIds, (palette) =>
              options.appearance.setPalette(scheme, palette)
            ),
          ] as const
      ),
      [
        "appearance.priceColors",
        choice(Object.values(PriceColors), (priceColors) =>
          options.appearance.setPriceColors(priceColors)
        ),
      ],
      [
        "appearance.language",
        choice(Object.values(LanguagePreference), (language) =>
          options.appearance.setLanguage(language)
        ),
      ],
      [
        "appearance.timeZone",
        {
          accepts: 'system, or an IANA time zone name such as "Asia/Taipei"',
          parse(value) {
            const timeZone = timeZonePreferenceSchema.safeParse(value);

            return timeZone.success
              ? async () => options.appearance.setTimeZone(timeZone.data)
              : undefined;
          },
        },
      ],
      [
        "marketData.TW",
        choice(Object.values(MarketDataSource), (source) =>
          config.set(["marketData", Market.TW], source)
        ),
      ],
      [
        "providers.fugle.plan",
        choice(Object.values(FuglePlan), (plan) =>
          config.set(["providers", "fugle", "plan"], plan)
        ),
      ],
      [
        "providers.finmind.plan",
        choice(Object.values(FinMindPlan), (plan) =>
          config.set(["providers", "finmind", "plan"], plan)
        ),
      ],
      [
        "agent.provider",
        choice(
          usable,
          (provider) => options.models.setDefaultProvider(provider),
          `${oneOf(usable)}, the providers with a key saved or a subscription signed in; it starts on the provider's default model`
        ),
      ],
      [
        "agent.model",
        choice(
          modelIds,
          (model) => config.set(["agent", "model"], model),
          modelIds.length > LISTED_MODELS
            ? `a model id ${models.provider} lists, such as ${modelIds.slice(0, LISTED_MODELS).join(", ")}; ask the user for the id the model picker shows`
            : oneOf(modelIds)
        ),
      ],
      [
        "agent.thinking",
        choice(Object.values(AgentThinking), (thinking) =>
          config.set(["agent", "thinking"], thinking)
        ),
      ],
      [
        "agent.decisionMode",
        choice(Object.values(DecisionMode), (mode) =>
          config.set(["agent", "decisionMode"], mode)
        ),
      ],
      ...Object.values(CollectionJob).map(
        (job) => [`collection.${job}`, collection(job)] as const
      ),
      [
        "webSearch.provider",
        choice(Object.values(WebSearchProvider), (provider) =>
          config.set(["webSearch", "provider"], provider)
        ),
      ],
      [
        "decisions.provider",
        choice(Object.values(DecisionsProvider), (provider) =>
          config.set(["decisions", "provider"], provider)
        ),
      ],
      [
        "embeddings.enabled",
        flag((enabled) => config.set(["embeddings", "enabled"], enabled)),
      ],
      [
        "embeddings.provider",
        choice(Object.values(EmbeddingsProvider), (provider) =>
          config.set(["embeddings", "provider"], provider)
        ),
      ],
      [
        "updates.check",
        flag((check) => config.set(["updates", "check"], check)),
      ],
    ]);
  }

  /** What makes the change, or the reason the agent may not make it, worded for the model. */
  async function prepare({ setting, value }: SettingChange) {
    const changeable = (await changeables()).get(setting);

    if (!changeable) {
      throw new Error(
        `${setting} is not a setting change_setting takes: either only the user changes it, on its tab, or no setting has that name. get_setup says which settings it takes.`
      );
    }

    const save = changeable.parse(value);

    if (!save) {
      throw new Error(
        `${setting} takes ${changeable.accepts}, not "${value}".`
      );
    }

    return save;
  }

  return {
    async read() {
      const [market, agentAreas, skillsArea, mcpArea, changes] =
        await Promise.all([
          marketData(),
          agent(),
          skills(),
          mcp(),
          changeables(),
        ]);

      return [
        appearance(),
        market,
        ...agentAreas,
        skillsArea,
        schedules(),
        themes(),
        memory(),
        mcpArea,
        about(),
      ].map((area) => ({
        ...area,
        settings: area.settings.map((setting) => {
          const accepts = changes.get(setting.name)?.accepts;

          return accepts ? { ...setting, accepts } : setting;
        }),
      }));
    },

    async check(change) {
      await prepare(change);
    },

    async change(change) {
      await (
        await prepare(change)
      )();
    },
  };
}
