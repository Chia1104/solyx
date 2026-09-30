import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { BrowserWindow, app, dialog, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { mapValues, uniq } from "es-toolkit";
import * as z from "zod";

import { effectivePolicy } from "@solyx/agent/mcp";
import {
  mcpSecretNameSchema,
  mcpToolKey,
  mcpToolPolicySchema,
} from "@solyx/agent/mcp-config";
import {
  DEFAULT_MODEL,
  agentAuthSchema,
  agentProviderSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import { SkillSource } from "@solyx/agent/skills";
import { Market } from "@solyx/core/market";
import { fuglePlanSchema } from "@solyx/market-data/fugle";

import {
  AppLocation,
  FubonFile,
  MarketDataSource,
  Secret,
  Theme,
  settingsChannels,
} from "#shared/ipc/settings.ts";
import type { SettingsApi } from "#shared/ipc/settings.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

// A sign-in's tokens are saved by the sign-in itself, never typed in or replaced from here.
const secretSchema = z.enum(Secret).exclude(["OpenAIChatGPT"]);

const handle = ipcModule<SettingsApi>(settingsChannels, {
  theme: z.tuple([]),
  setTheme: z.tuple([z.enum(Theme)]),
  secrets: z.tuple([]),
  saveSecret: z.tuple([secretSchema, z.string().trim().min(1).max(1024)]),
  deleteSecret: z.tuple([secretSchema]),
  marketData: z.tuple([]),
  setMarketDataSource: z.tuple([
    z.literal(Market.TW),
    z.enum(MarketDataSource),
  ]),
  setFuglePlan: z.tuple([fuglePlanSchema]),
  chooseFubonFile: z.tuple([z.enum(FubonFile)]),
  signInFubon: z.tuple([]),
  agent: z.tuple([]),
  setAgentProvider: z.tuple([agentProviderSchema]),
  setAgentModel: z.tuple([z.string().trim().min(1).max(200)]),
  setAgentThinking: z.tuple([agentThinkingSchema]),
  setAgentAuth: z.tuple([agentAuthSchema]),
  signInSubscription: z.tuple([z.string().min(2).max(35)]),
  cancelSignIn: z.tuple([]),
  signOutSubscription: z.tuple([]),
  agentSkills: z.tuple([]),
  setSharedSkill: z.tuple([z.string().min(1).max(64), z.boolean()]),
  mcp: z.tuple([]),
  setMcpToolPolicy: z.tuple([
    z.string().min(1).max(128),
    z.string().min(1).max(128),
    mcpToolPolicySchema,
  ]),
  saveMcpSecret: z.tuple([
    z.string().min(1).max(128),
    mcpSecretNameSchema,
    z.string().trim().min(1).max(4096),
  ]),
  deleteMcpSecret: z.tuple([z.string().min(1).max(128), mcpSecretNameSchema]),
  reconnectMcp: z.tuple([z.string().min(1).max(128)]),
  cacheUsage: z.tuple([]),
  clearCache: z.tuple([]),
  about: z.tuple([]),
  reveal: z.tuple([z.enum(AppLocation)]),
});

// People know these by name rather than by Node's platform ids.
const OS_NAME: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const FUBON_FILE_DIALOG: Record<FubonFile, OpenDialogOptions> = {
  [FubonFile.Sdk]: { properties: ["openDirectory"] },
  [FubonFile.Certificate]: {
    properties: ["openFile"],
    filters: [{ name: "PKCS #12", extensions: ["pfx", "p12"] }],
  },
};

export function registerSettingsIpc({
  theme,
  applyTheme,
  secrets,
  config,
  cache,
  home,
  locations,
  applySettings,
  marketData,
  liveCandles,
  agent,
  mcp,
}: Services) {
  handle("theme", async () => theme());

  handle("setTheme", async (next) => {
    config.set(["theme"], next);
    applyTheme();
  });

  handle("secrets", async () => ({
    available: await secrets.available(),
    states: await secrets.states(),
  }));

  // The live stream authenticates once per connection, so a changed key reopens it.
  handle("saveSecret", async (secret, value) => {
    await secrets.save(secret, value);
    await liveCandles.restart();
  });

  handle("deleteSecret", async (secret) => {
    await secrets.delete(secret);
    await liveCandles.restart();
  });

  handle("marketData", () => marketData.status());

  handle("setMarketDataSource", async (market, source) => {
    config.set(["marketData", market], source);
    await applySettings();
  });

  handle("setFuglePlan", async (plan) => {
    config.set(["providers", "fugle", "plan"], plan);
    await applySettings();
  });

  handle("chooseFubonFile", async (file, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = FUBON_FILE_DIALOG[file];

    const { canceled, filePaths } = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));

    const [path] = filePaths;

    if (canceled || path === undefined) return null;

    config.set(["providers", "fubon", file], path);
    await applySettings();

    return path;
  });

  // The stream keeps the session it opened with, so a new sign-in reopens it.
  handle("signInFubon", async () => {
    await marketData.signInFubon();
    await liveCandles.restart();
  });

  handle("agent", () => agent.models.settings());

  // A model id means nothing to another provider, so switching starts from its default.
  handle("setAgentProvider", async (provider) => {
    config.set(["agent", "provider"], provider);
    config.set(["agent", "model"], DEFAULT_MODEL[provider]);
  });

  handle("setAgentModel", async (model) => {
    config.set(["agent", "model"], model);
  });

  handle("setAgentThinking", async (thinking) => {
    config.set(["agent", "thinking"], thinking);
  });

  handle("setAgentAuth", async (auth) => {
    config.set(["agent", "auth"], auth);
  });

  handle("signInSubscription", (locale) => agent.models.signIn(locale));

  handle("cancelSignIn", async () => agent.models.cancelSignIn());

  handle("signOutSubscription", () => agent.models.signOut());

  handle("agentSkills", async () => {
    const [catalog, instructions] = await Promise.all([
      agent.skills(),
      agent.instructions(),
    ]);

    return {
      skills: catalog.skills.map(({ name, description, source, offered }) => ({
        name,
        description,
        source,
        offered,
        switchable: source === SkillSource.Shared,
      })),
      warnings: catalog.warnings.map((warning) => warning.replace(home, "~")),
      instructions: instructions ? { characters: instructions.length } : null,
      paths: {
        skills: locations[AppLocation.Skills].replace(home, "~"),
        shared: "~/.agents/skills",
        instructions: join(dirname(config.file), "AGENTS.md").replace(
          home,
          "~"
        ),
      },
    };
  });

  handle("setSharedSkill", async (name, enabled) => {
    const current = config.read().agent?.sharedSkills ?? [];

    config.set(
      ["agent", "sharedSkills"],
      enabled
        ? uniq([...current, name])
        : current.filter((skill) => skill !== name)
    );
  });

  handle("mcp", async () => {
    const [{ error, servers }, saved] = await Promise.all([
      mcp.status(),
      secrets.saved(),
    ]);

    const policies = mcp.policies();

    return {
      path: mcp.file.replace(home, "~"),
      error,
      servers: servers.map((server) => ({
        name: server.name,
        kind: server.kind,
        target: server.target.replace(home, "~"),
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
          saved: saved.includes(`mcp:${name}`),
        })),
      })),
    };
  });

  handle("setMcpToolPolicy", async (server, tool, policy) => {
    config.set(["agent", "mcpTools", mcpToolKey(server, tool)], policy);
  });

  // A server reads its secrets as it connects, so a changed one reconnects it.
  handle("saveMcpSecret", async (server, name, value) => {
    await secrets.save(`mcp:${name}`, value);
    mcp.reconnect(server);
  });

  handle("deleteMcpSecret", async (server, name) => {
    await secrets.delete(`mcp:${name}`);
    mcp.reconnect(server);
  });

  handle("reconnectMcp", async (server) => mcp.reconnect(server));

  handle("cacheUsage", async () => cache.usage());

  handle("clearCache", async () => cache.clear());

  handle("about", async () => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    os: `${OS_NAME[process.platform] ?? process.platform} ${process.getSystemVersion()} (${process.arch})`,
    locations: mapValues(locations, (path) => path.replace(home, "~")),
  }));

  handle("reveal", async (location) => {
    // The skills folder is the user's to create; showing it is the first step to filling it.
    if (location === AppLocation.Skills) {
      await mkdir(locations[location], { recursive: true });
    }

    if (location === AppLocation.Mcp) await mcp.create();

    shell.showItemInFolder(locations[location]);
  });
}
