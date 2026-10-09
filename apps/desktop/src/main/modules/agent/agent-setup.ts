import { McpServerState } from "@solyx/agent/mcp-config";
import type { SetupArea, SetupPort, SetupSetting } from "@solyx/agent/setup";
import { SkillSource } from "@solyx/agent/skill-source";
import type { SkillCatalog } from "@solyx/agent/skills";
import { DecisionMode } from "@solyx/core/council";
import { Market } from "@solyx/core/market";
import type { MemoryStore } from "@solyx/core/memory";
import { DecisionsProvider } from "@solyx/decisions/provider";
import { EmbeddingsProvider } from "@solyx/embeddings/provider";

import {
  DECISIONS_SECRETS,
  FubonFile,
  FubonSessionState,
  MarketDataSource,
  Secret,
  SecretState,
  isDecisionsReady,
  isMarketDataReady,
  isWebSearchReady,
  mcpSecretKey,
} from "#shared/ipc/settings.ts";
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
  appearance: Pick<AppearanceSettings, "read">;
  marketData: Pick<MarketDataModule, "status">;
  webSearch: Pick<WebSearchModule, "settings">;
  decisions: Pick<Decisions, "settings">;
  embeddings: Pick<Embeddings, "settings">;
  version: string;
  /** Paths are shown with it as `~`. */
  home: string;
}

export interface AgentSetupOptions extends AgentSetupSources {
  config: ConfigFile;
  secrets: Pick<SecretStore, "available" | "states" | "saved">;
  models: Pick<AgentModels, "settings">;
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

/** The settings page's tabs as the agent reads them, with what keeps each from working. */
export function createAgentSetup(options: AgentSetupOptions): SetupPort {
  const { config, secrets } = options;
  const tildify = (path: string) => path.replace(options.home, "~");

  function appearance(): SetupArea {
    const { theme, palette, palettes, priceColors } = options.appearance.read();

    const paletteName = (id: string) =>
      palettes[id] ? `${id} (the user's own "${palettes[id].name}")` : id;

    return {
      name: "General",
      link: settingsLink(SettingsSection.General),
      missing: [],
      settings: [
        entry(["appearance", "theme"], theme),
        entry(
          ["appearance", "palette"],
          `light ${paletteName(palette.light)}, dark ${paletteName(palette.dark)}`
        ),
        entry(["appearance", "priceColors"], priceColors),
        {
          name: "language and time zone",
          value: "as the context gives them",
          description:
            "Set on this tab and kept by the app's window; replies follow the language.",
        },
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
        name: "News",
        link,
        missing: [],
        settings: [
          entry(
            ["news", "collectEveryHours"],
            String(config.read().news.collectEveryHours)
          ),
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
          entry(["embeddings", "enabled"], onOff(embeddings.enabled)),
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
            ? "on, but kept off while the account is live"
            : onOff(shell)
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
        entry(["agent", "memory"], onOff(config.read().agent.memory)),
        {
          name: "memories kept",
          value: String(options.memory.list().length),
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
        entry(["updates", "check"], onOff(config.read().updates.check)),
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

  return {
    async read() {
      const [market, agentAreas, skillsArea, mcpArea] = await Promise.all([
        marketData(),
        agent(),
        skills(),
        mcp(),
      ]);

      return [
        appearance(),
        market,
        ...agentAreas,
        skillsArea,
        memory(),
        mcpArea,
        about(),
      ];
    },
  };
}
