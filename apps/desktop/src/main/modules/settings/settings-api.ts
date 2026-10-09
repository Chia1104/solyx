import { mkdir } from "node:fs/promises";

import type { IpcMainInvokeEvent } from "electron";
import { mapValues, uniq } from "es-toolkit";

import { effectivePolicy, mcpToolKey } from "@solyx/agent/mcp-config";
import { SkillSource } from "@solyx/agent/skill-source";
import type { SkillFolders } from "@solyx/agent/skills";
import { DecisionsProvider } from "@solyx/decisions/provider";
import { FINMIND_PLANS } from "@solyx/fundamentals/finmind";

import {
  AppLocation,
  mcpSecretKey,
  webSearchKeySecret,
} from "#shared/ipc/settings.ts";
import type { AppInfo, FubonFile, SettingsApi } from "#shared/ipc/settings.ts";

import type { AgentService } from "../agent/agent-service.ts";
import type { McpServers } from "../agent/mcp-servers.ts";
import type { Decisions } from "../decisions/decisions.ts";
import type { Embeddings } from "../embeddings/embeddings.ts";
import type { MarketDataModule } from "../market/market-data.ts";
import type { WebSearchModule } from "../web-search/web-search.ts";

import type { AppearanceSettings } from "./appearance.ts";
import type { ConfigFile } from "./config-file.ts";
import type { SecretStore } from "./secret-store.ts";

/** What only Electron does for the settings page. */
export interface SettingsShell {
  /** Asks for one of Fubon's files in a dialog over the asking window; `null` when cancelled. */
  chooseFubonFile(
    file: FubonFile,
    event: IpcMainInvokeEvent
  ): Promise<string | null>;
  showItemInFolder(path: string): void;
  /** The app and the runtime it runs on, as About shows them. */
  about(): Omit<AppInfo, "locations">;
  /** This build has somewhere to send crash reports. */
  canReportCrashes: boolean;
}

export interface SettingsApiOptions {
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
  shell: SettingsShell;
}

/** The contract, with the dialog that picks a Fubon file shown over the window that asked. */
type SettingsHandlers = Omit<SettingsApi, "chooseFubonFile"> & {
  chooseFubonFile(
    file: FubonFile,
    event: IpcMainInvokeEvent
  ): Promise<string | null>;
};

/** The settings page's side of the main process, one method per `SettingsApi` channel. */
export function createSettingsApi({
  config,
  secrets,
  appearance,
  marketData,
  agent,
  mcp,
  decisions,
  embeddings,
  webSearch,
  home,
  locations,
  skillFolders,
  instructionsFile,
  shell,
}: SettingsApiOptions): SettingsHandlers {
  const tildify = (path: string) => path.replace(home, "~");

  return {
    appearance: async () => appearance.read(),

    setTheme: async (theme) => appearance.setTheme(theme),

    setPalette: async (scheme, palette) =>
      appearance.setPalette(scheme, palette),

    copyPalette: async (source, name) => appearance.copyPalette(source, name),

    renamePalette: async (palette, name) =>
      appearance.renamePalette(palette, name),

    setPaletteColor: async (palette, scheme, token, color) =>
      appearance.setPaletteColor(palette, scheme, token, color),

    deletePalette: async (palette) => appearance.deletePalette(palette),

    setPriceColors: async (priceColors) =>
      appearance.setPriceColors(priceColors),

    secrets: async () => ({
      available: await secrets.available(),
      states: await secrets.states(),
    }),

    saveSecret: (secret, value) => secrets.save(secret, value),

    deleteSecret: (secret) => secrets.delete(secret),

    marketData: () => marketData.status(),

    async setMarketDataSource(market, source) {
      config.set(["marketData", market], source);
    },

    async setFuglePlan(plan) {
      config.set(["providers", "fugle", "plan"], plan);
    },

    async chooseFubonFile(file, event) {
      const path = await shell.chooseFubonFile(file, event);

      if (path !== null) config.set(["providers", "fubon", file], path);

      return path;
    },

    signInFubon: () => marketData.signInFubon(),

    agent: () => agent.models.settings(),

    setAgentProviderEnabled: (provider, enabled) =>
      agent.models.setProviderEnabled(provider, enabled),

    setAgentProvider: (provider) => agent.models.setDefaultProvider(provider),

    async setAgentModel(model) {
      config.set(["agent", "model"], model);
    },

    async setAgentThinking(thinking) {
      config.set(["agent", "thinking"], thinking);
    },

    async setAgentDecisionMode(mode) {
      config.set(["agent", "decisionMode"], mode);
    },

    async setMagiModel(unit, model) {
      config.set(["agent", "magi", unit], model);
    },

    async setAgentAuth(auth) {
      config.set(["agent", "auth"], auth);
    },

    saveAgentKey: (provider, value) => agent.models.saveKey(provider, value),

    deleteAgentKey: (provider) => agent.models.deleteKey(provider),

    setAgentEndpoint: (provider, endpoint) =>
      agent.models.setEndpoint(provider, endpoint),

    signInSubscription: (provider, locale) =>
      agent.models.signIn(provider, locale),

    cancelSignIn: async () => agent.models.cancelSignIn(),

    signOutSubscription: (provider) => agent.models.signOut(provider),

    news: async () => ({
      collectEveryHours: config.read().news.collectEveryHours,
    }),

    async setNewsCollectEveryHours(hours) {
      config.set(["news", "collectEveryHours"], hours);
    },

    fundamentals: async () => ({
      finMind: {
        plan: config.read().providers.finmind.plan,
        plans: Object.values(FINMIND_PLANS),
      },
    }),

    async setFinMindPlan(plan) {
      config.set(["providers", "finmind", "plan"], plan);
    },

    webSearch: () => webSearch.settings(),

    async setWebSearchProvider(provider) {
      config.set(["webSearch", "provider"], provider);
    },

    saveWebSearchKey: (provider, value) =>
      secrets.save(webSearchKeySecret(provider), value),

    deleteWebSearchKey: (provider) =>
      secrets.delete(webSearchKeySecret(provider)),

    decisions: async () => decisions.settings(),

    async setDecisionsProvider(provider) {
      config.set(["decisions", "provider"], provider);
    },

    // Removing the entry reads as the default.
    async setDecisionsModel(provider, model) {
      config.set(["decisions", provider, "model"], model ?? undefined);
    },

    async setDecisionsBaseURL(provider, baseURL) {
      config.set(["decisions", provider, "baseURL"], baseURL ?? undefined);
    },

    async setDecisionsAccountId(accountId) {
      config.set(
        ["decisions", DecisionsProvider.Cloudflare, "accountId"],
        accountId ?? undefined
      );
    },

    embeddings: async () => embeddings.settings(),

    async setEmbeddingsEnabled(enabled) {
      config.set(["embeddings", "enabled"], enabled);
    },

    async setEmbeddingsProvider(provider) {
      config.set(["embeddings", "provider"], provider);
    },

    async agentSkills() {
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
        warnings: catalog.warnings.map(tildify),
        instructions: instructions ? { characters: instructions.length } : null,
        paths: {
          skills: tildify(skillFolders.solyx),
          shared: tildify(skillFolders.shared),
          instructions: tildify(instructionsFile),
        },
        shell: config.read().agent.shell,
      };
    },

    async setSharedSkill(name, enabled) {
      const current = config.read().agent.sharedSkills;

      config.set(
        ["agent", "sharedSkills"],
        enabled
          ? uniq([...current, name])
          : current.filter((skill) => skill !== name)
      );
    },

    async setAgentShell(enabled) {
      config.set(["agent", "shell"], enabled);
    },

    memory: async () => ({ enabled: config.read().agent.memory }),

    async setMemoryEnabled(enabled) {
      config.set(["agent", "memory"], enabled);
    },

    updates: async () => ({ check: config.read().updates.check }),

    async setUpdateChecks(enabled) {
      config.set(["updates", "check"], enabled);
    },

    crashReports: async () => ({
      send: config.read().crashReports.send,
      available: shell.canReportCrashes,
    }),

    async setCrashReports(send) {
      config.set(["crashReports", "send"], send);
    },

    async mcp() {
      const [{ error, servers }, saved] = await Promise.all([
        mcp.status(),
        secrets.saved(),
      ]);

      const policies = mcp.policies();

      return {
        path: tildify(mcp.file),
        error,
        servers: servers.map((server) => ({
          name: server.name,
          kind: server.kind,
          target: tildify(server.target),
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
    },

    async setMcpToolPolicy(server, tools, policy) {
      config.update(
        tools.map((tool) => [
          ["agent", "mcpTools", mcpToolKey(server, tool)],
          policy,
        ])
      );
    },

    // A server reads its secrets as it connects, so a changed one reconnects it.
    async saveMcpSecret(server, name, value) {
      await secrets.save(mcpSecretKey(name), value);
      mcp.reconnect(server);
    },

    async deleteMcpSecret(server, name) {
      await secrets.delete(mcpSecretKey(name));
      mcp.reconnect(server);
    },

    reconnectMcp: async (server) => mcp.reconnect(server),

    signInMcp: (server, locale) => mcp.signIn(server, locale),

    cancelMcpSignIn: async () => mcp.cancelSignIn(),

    signOutMcp: (server) => mcp.signOut(server),

    about: async () => ({
      ...shell.about(),
      locations: mapValues(locations, tildify),
    }),

    async reveal(location) {
      // The skills folder is the user's to create; showing it is the first step to filling it.
      if (location === AppLocation.Skills) {
        await mkdir(locations[location], { recursive: true });
      }

      if (location === AppLocation.Mcp) await mcp.create();

      shell.showItemInFolder(locations[location]);
    },
  };
}
