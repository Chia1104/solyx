import { mkdir } from "node:fs/promises";

import type { MemoryPublisher } from "@orpc/publisher/memory";
import { implement } from "@orpc/server";
import type { WebContents } from "electron";
import { mapValues, uniq } from "es-toolkit";

import { effectivePolicy, mcpToolKey } from "@solyx/agent/mcp-config";
import { SkillSource } from "@solyx/agent/skill-source";
import type { SkillFolders } from "@solyx/agent/skills";
import { DecisionsProvider } from "@solyx/decisions/provider";
import { FINMIND_PLANS } from "@solyx/fundamentals/finmind";

import { settingsContract } from "#shared/rpc/settings.contract.ts";
import {
  AppLocation,
  Secret,
  mcpSecretKey,
  webSearchKeySecret,
} from "#shared/settings.ts";
import type { AppInfo, FubonFile } from "#shared/settings.ts";

import type { WindowEvents } from "../../rpc/window-events.ts";
import type { AgentService } from "../agent/agent-service.ts";
import type { McpServers } from "../agent/mcp-servers.ts";
import type { Decisions } from "../decisions/decisions.ts";
import type { Embeddings } from "../embeddings/embeddings.ts";
import type { MarketDataModule } from "../market/market-data.ts";
import { parseOtlpHeaders } from "../telemetry/otlp-headers.ts";
import type { WebSearchModule } from "../web-search/web-search.ts";

import type { AppearanceSettings } from "./appearance.ts";
import type { ConfigFile } from "./config-file.ts";
import type { SecretStore } from "./secret-store.ts";

/** What only Electron does for the settings page. */
export interface SettingsShell {
  /** Asks for one of Fubon's files in a dialog over the asking window; `null` when cancelled. */
  chooseFubonFile(file: FubonFile, sender: WebContents): Promise<string | null>;
  showItemInFolder(path: string): void;
  /** The app and the runtime it runs on, as About shows them. */
  about(): Omit<AppInfo, "locations">;
  /** This build has somewhere to send crash reports. */
  canReportCrashes: boolean;
  /** This computer has a Dock, as only macOS does. */
  hasDock: boolean;
}

/**
 * What the settings procedures read of the services, so they are tested without the rest: the
 * config file and the secrets, the modules a tab sets up, and the window that asked.
 */
export interface SettingsContext {
  config: ConfigFile;
  secrets: SecretStore;
  appearance: AppearanceSettings;
  marketData: Pick<MarketDataModule, "status" | "signInFubon">;
  agent: Pick<AgentService, "models" | "skills" | "instructions">;
  mcp: Pick<
    McpServers,
    | "file"
    | "policies"
    | "status"
    | "reconnect"
    | "signIn"
    | "cancelSignIn"
    | "signOut"
    | "create"
  >;
  decisions: Pick<Decisions, "settings">;
  embeddings: Pick<Embeddings, "settings">;
  webSearch: Pick<WebSearchModule, "settings">;
  /** Paths are shown with it as `~`. */
  home: string;
  locations: Record<AppLocation, string>;
  skillFolders: SkillFolders;
  instructionsFile: string;
  settingsShell: SettingsShell;
  windowEvents: Pick<MemoryPublisher<WindowEvents>, "subscribe">;
  sender: WebContents;
}

/** A path as the settings page shows it, with the home folder as `~`. */
const tildify = (home: string, path: string) => path.replace(home, "~");

const settings = implement(settingsContract).$context<SettingsContext>();

export const settingsRouter = settings.router({
  appearance: settings.appearance.handler(({ context }) =>
    context.appearance.read()
  ),
  setTheme: settings.setTheme.handler(({ context, input }) =>
    context.appearance.setTheme(input)
  ),
  setPalette: settings.setPalette.handler(({ context, input }) =>
    context.appearance.setPalette(input.scheme, input.palette)
  ),
  copyPalette: settings.copyPalette.handler(({ context, input }) =>
    context.appearance.copyPalette(input.palette, input.name)
  ),
  renamePalette: settings.renamePalette.handler(({ context, input }) =>
    context.appearance.renamePalette(input.palette, input.name)
  ),
  setPaletteColor: settings.setPaletteColor.handler(({ context, input }) =>
    context.appearance.setPaletteColor(
      input.palette,
      input.scheme,
      input.token,
      input.color
    )
  ),
  deletePalette: settings.deletePalette.handler(({ context, input }) =>
    context.appearance.deletePalette(input)
  ),
  setPriceColors: settings.setPriceColors.handler(({ context, input }) =>
    context.appearance.setPriceColors(input)
  ),
  setLanguage: settings.setLanguage.handler(({ context, input }) =>
    context.appearance.setLanguage(input)
  ),
  setTimeZone: settings.setTimeZone.handler(({ context, input }) =>
    context.appearance.setTimeZone(input)
  ),

  secrets: settings.secrets.handler(async ({ context }) => ({
    available: await context.secrets.available(),
    states: await context.secrets.states(),
  })),
  saveSecret: settings.saveSecret.handler(async ({ context, input }) => {
    // Checked here, since a value that does not parse would only fail as traces and logs go out.
    if (input.secret === Secret.OtlpHeaders) parseOtlpHeaders(input.value);

    await context.secrets.save(input.secret, input.value);
  }),
  deleteSecret: settings.deleteSecret.handler(({ context, input }) =>
    context.secrets.delete(input)
  ),

  marketData: settings.marketData.handler(({ context }) =>
    context.marketData.status()
  ),
  setMarketDataSource: settings.setMarketDataSource.handler(
    ({ context, input }) => {
      context.config.set(["marketData", input.market], input.source);
    }
  ),
  setFuglePlan: settings.setFuglePlan.handler(({ context, input }) => {
    context.config.set(["providers", "fugle", "plan"], input);
  }),
  chooseFubonFile: settings.chooseFubonFile.handler(
    async ({ context, input }) => {
      const path = await context.settingsShell.chooseFubonFile(
        input,
        context.sender
      );

      if (path !== null)
        context.config.set(["providers", "fubon", input], path);

      return path;
    }
  ),
  signInFubon: settings.signInFubon.handler(({ context }) =>
    context.marketData.signInFubon()
  ),

  agent: settings.agent.handler(({ context }) =>
    context.agent.models.settings()
  ),
  setAgentProviderEnabled: settings.setAgentProviderEnabled.handler(
    ({ context, input }) =>
      context.agent.models.setProviderEnabled(input.provider, input.enabled)
  ),
  setAgentProvider: settings.setAgentProvider.handler(({ context, input }) =>
    context.agent.models.setDefaultProvider(input)
  ),
  setAgentModel: settings.setAgentModel.handler(({ context, input }) => {
    context.config.set(["agent", "model"], input);
  }),
  setAgentThinking: settings.setAgentThinking.handler(({ context, input }) => {
    context.config.set(["agent", "thinking"], input);
  }),
  setAgentDecisionMode: settings.setAgentDecisionMode.handler(
    ({ context, input }) => {
      context.config.set(["agent", "decisionMode"], input);
    }
  ),
  setMagiModel: settings.setMagiModel.handler(({ context, input }) => {
    context.config.set(["agent", "magi", input.unit], input.model);
  }),
  setAgentAuth: settings.setAgentAuth.handler(({ context, input }) =>
    context.agent.models.setAuth(input.provider, input.auth)
  ),
  saveAgentKey: settings.saveAgentKey.handler(({ context, input }) =>
    context.agent.models.saveKey(input.provider, input.value)
  ),
  deleteAgentKey: settings.deleteAgentKey.handler(({ context, input }) =>
    context.agent.models.deleteKey(input)
  ),
  createAgentKey: settings.createAgentKey.handler(({ context, input }) =>
    context.agent.models.createKey(input.provider, input.locale)
  ),
  setAgentEndpoint: settings.setAgentEndpoint.handler(({ context, input }) =>
    context.agent.models.setEndpoint(input.provider, input.endpoint)
  ),
  signInSubscription: settings.signInSubscription.handler(
    ({ context, input }) =>
      context.agent.models.signIn(input.provider, input.locale)
  ),
  cancelSignIn: settings.cancelSignIn.handler(({ context }) =>
    context.agent.models.cancelSignIn()
  ),
  signOutSubscription: settings.signOutSubscription.handler(
    ({ context, input }) => context.agent.models.signOut(input)
  ),

  fundamentals: settings.fundamentals.handler(({ context }) => ({
    finMind: {
      plan: context.config.read().providers.finmind.plan,
      plans: Object.values(FINMIND_PLANS),
    },
  })),
  setFinMindPlan: settings.setFinMindPlan.handler(({ context, input }) => {
    context.config.set(["providers", "finmind", "plan"], input);
  }),

  webSearch: settings.webSearch.handler(({ context }) =>
    context.webSearch.settings()
  ),
  setWebSearchProvider: settings.setWebSearchProvider.handler(
    ({ context, input }) => {
      context.config.set(["webSearch", "provider"], input);
    }
  ),
  saveWebSearchKey: settings.saveWebSearchKey.handler(({ context, input }) =>
    context.secrets.save(webSearchKeySecret(input.provider), input.value)
  ),
  deleteWebSearchKey: settings.deleteWebSearchKey.handler(
    ({ context, input }) => context.secrets.delete(webSearchKeySecret(input))
  ),

  decisions: settings.decisions.handler(({ context }) =>
    context.decisions.settings()
  ),
  setDecisionsProvider: settings.setDecisionsProvider.handler(
    ({ context, input }) => {
      context.config.set(["decisions", "provider"], input);
    }
  ),
  // Removing the entry reads as the default.
  setDecisionsModel: settings.setDecisionsModel.handler(
    ({ context, input }) => {
      context.config.set(
        ["decisions", input.provider, "model"],
        input.model ?? undefined
      );
    }
  ),
  setDecisionsBaseURL: settings.setDecisionsBaseURL.handler(
    ({ context, input }) => {
      context.config.set(
        ["decisions", input.provider, "baseURL"],
        input.baseURL ?? undefined
      );
    }
  ),
  setDecisionsAccountId: settings.setDecisionsAccountId.handler(
    ({ context, input }) => {
      context.config.set(
        ["decisions", DecisionsProvider.Cloudflare, "accountId"],
        input ?? undefined
      );
    }
  ),

  embeddings: settings.embeddings.handler(({ context }) =>
    context.embeddings.settings()
  ),
  setEmbeddingsEnabled: settings.setEmbeddingsEnabled.handler(
    ({ context, input }) => {
      context.config.set(["embeddings", "enabled"], input);
    }
  ),
  setEmbeddingsProvider: settings.setEmbeddingsProvider.handler(
    ({ context, input }) => {
      context.config.set(["embeddings", "provider"], input);
    }
  ),

  agentSkills: settings.agentSkills.handler(async ({ context }) => {
    const { agent, config, home, skillFolders, instructionsFile } = context;

    const [catalog, instructions] = await Promise.all([
      agent.skills(),
      agent.instructions(),
    ]);

    return {
      skills: catalog.skills.map(
        ({ name, description, source, offered, userInvocable }) => ({
          name,
          description,
          source,
          offered,
          userInvocable,
          switchable: source === SkillSource.Shared,
        })
      ),
      warnings: catalog.warnings.map((warning) => tildify(home, warning)),
      instructions: instructions ? { characters: instructions.length } : null,
      paths: {
        skills: tildify(home, skillFolders.solyx),
        shared: tildify(home, skillFolders.shared),
        instructions: tildify(home, instructionsFile),
      },
      shell: config.read().agent.shell,
    };
  }),
  setSharedSkill: settings.setSharedSkill.handler(({ context, input }) => {
    const current = context.config.read().agent.sharedSkills;

    context.config.set(
      ["agent", "sharedSkills"],
      input.enabled
        ? uniq([...current, input.name])
        : current.filter((skill) => skill !== input.name)
    );
  }),
  setAgentShell: settings.setAgentShell.handler(({ context, input }) => {
    context.config.set(["agent", "shell"], input);
  }),

  memory: settings.memory.handler(({ context }) => ({
    enabled: context.config.read().agent.memory,
  })),
  setMemoryEnabled: settings.setMemoryEnabled.handler(({ context, input }) => {
    context.config.set(["agent", "memory"], input);
  }),

  tray: settings.tray.handler(({ context }) => {
    const { show, hideDock } = context.config.read().tray;

    return { show, hideDock, hasDock: context.settingsShell.hasDock };
  }),
  setTrayShown: settings.setTrayShown.handler(({ context, input }) => {
    context.config.set(["tray", "show"], input);
  }),
  setDockHidden: settings.setDockHidden.handler(({ context, input }) => {
    context.config.set(["tray", "hideDock"], input);
  }),

  newsRetention: settings.newsRetention.handler(
    ({ context }) => context.config.read().news.kept
  ),
  setNewsRetention: settings.setNewsRetention.handler(
    ({ context, input: { voice, retention } }) => {
      context.config.set(["news", "kept", voice], retention);
    }
  ),

  updates: settings.updates.handler(({ context }) => ({
    check: context.config.read().updates.check,
  })),
  setUpdateChecks: settings.setUpdateChecks.handler(({ context, input }) => {
    context.config.set(["updates", "check"], input);
  }),

  otlp: settings.otlp.handler(({ context }) => ({
    endpoint: context.config.read().otlp.endpoint ?? null,
  })),
  setOtlpEndpoint: settings.setOtlpEndpoint.handler(({ context, input }) => {
    context.config.set(["otlp", "endpoint"], input ?? undefined);
  }),

  crashReports: settings.crashReports.handler(({ context }) => ({
    send: context.config.read().crashReports.send,
    available: context.settingsShell.canReportCrashes,
  })),
  setCrashReports: settings.setCrashReports.handler(({ context, input }) => {
    context.config.set(["crashReports", "send"], input);
  }),

  mcp: settings.mcp.handler(async ({ context }) => {
    const { mcp, secrets, home } = context;

    const [{ error, servers }, saved] = await Promise.all([
      mcp.status(),
      secrets.saved(),
    ]);

    const policies = mcp.policies();

    return {
      path: tildify(home, mcp.file),
      error,
      servers: servers.map((server) => ({
        name: server.name,
        kind: server.kind,
        target: tildify(home, server.target),
        state: server.state,
        error: server.error,
        tools: server.tools.map((tool) => ({
          ...tool,
          policy: effectivePolicy(
            policies[mcpToolKey(server.name, tool.name)],
            tool.readOnly
          ),
        })),
        secrets: server.secrets.map((name) => ({
          name,
          saved: saved.includes(mcpSecretKey(name)),
        })),
        signedIn: server.signedIn,
      })),
    };
  }),
  setMcpToolPolicy: settings.setMcpToolPolicy.handler(({ context, input }) => {
    context.config.update(
      input.tools.map((tool) => [
        ["agent", "mcpTools", mcpToolKey(input.server, tool)],
        input.policy,
      ])
    );
  }),
  // A server reads its secrets as it connects, so a changed one reconnects it.
  saveMcpSecret: settings.saveMcpSecret.handler(async ({ context, input }) => {
    await context.secrets.save(mcpSecretKey(input.name), input.value);
    context.mcp.reconnect(input.server);
  }),
  deleteMcpSecret: settings.deleteMcpSecret.handler(
    async ({ context, input }) => {
      await context.secrets.delete(mcpSecretKey(input.name));
      context.mcp.reconnect(input.server);
    }
  ),
  reconnectMcp: settings.reconnectMcp.handler(({ context, input }) => {
    context.mcp.reconnect(input);
  }),
  signInMcp: settings.signInMcp.handler(({ context, input }) =>
    context.mcp.signIn(input.server, input.locale)
  ),
  cancelMcpSignIn: settings.cancelMcpSignIn.handler(({ context }) => {
    context.mcp.cancelSignIn();
  }),
  signOutMcp: settings.signOutMcp.handler(({ context, input }) =>
    context.mcp.signOut(input)
  ),

  about: settings.about.handler(({ context }) => ({
    ...context.settingsShell.about(),
    locations: mapValues(context.locations, (path) =>
      tildify(context.home, path)
    ),
  })),
  reveal: settings.reveal.handler(async ({ context, input }) => {
    const path = context.locations[input];

    // The skills folder is the user's to create; showing it is the first step to filling it.
    if (input === AppLocation.Skills) await mkdir(path, { recursive: true });

    if (input === AppLocation.Mcp) await context.mcp.create();

    context.settingsShell.showItemInFolder(path);
  }),

  changes: settings.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("settings:changed", { signal })
  ),
  appearanceChanges: settings.appearanceChanges.handler(({ context, signal }) =>
    context.windowEvents.subscribe("settings:appearance", { signal })
  ),
  signInCodes: settings.signInCodes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("settings:sign-in-code", { signal })
  ),
});
