import { mkdir } from "node:fs/promises";

import { BrowserWindow, app, dialog, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { mapValues, uniq } from "es-toolkit";
import * as z from "zod";

import {
  effectivePolicy,
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
import { SkillSource } from "@solyx/agent/skill-source";
import { Market } from "@solyx/core/market";
import { fuglePlanSchema } from "@solyx/market-data/fugle";

import {
  AppLocation,
  FubonFile,
  appLocationSchema,
  enteredSecretSchema,
  fubonFileSchema,
  localeSchema,
  marketDataSourceSchema,
  mcpSecretKey,
  priceColorsSchema,
  settingsChannels,
  themeSchema,
} from "#shared/ipc/settings.ts";
import type { SettingsApi } from "#shared/ipc/settings.ts";
import { colorSchemeSchema, paletteSchema } from "#shared/palette.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

// An MCP server's or tool's name, as mcp.json and the server give it.
const mcpNameSchema = z.string().min(1).max(128);

const handle = ipcModule<SettingsApi>(settingsChannels, {
  appearance: z.tuple([]),
  setTheme: z.tuple([themeSchema]),
  setPalette: z.tuple([colorSchemeSchema, paletteSchema]),
  setPriceColors: z.tuple([priceColorsSchema]),
  secrets: z.tuple([]),
  saveSecret: z.tuple([
    enteredSecretSchema,
    z.string().trim().min(1).max(1024),
  ]),
  deleteSecret: z.tuple([enteredSecretSchema]),
  marketData: z.tuple([]),
  setMarketDataSource: z.tuple([z.literal(Market.TW), marketDataSourceSchema]),
  setFuglePlan: z.tuple([fuglePlanSchema]),
  chooseFubonFile: z.tuple([fubonFileSchema]),
  signInFubon: z.tuple([]),
  agent: z.tuple([]),
  setAgentProvider: z.tuple([agentProviderSchema]),
  setAgentModel: z.tuple([z.string().trim().min(1).max(200)]),
  setAgentThinking: z.tuple([agentThinkingSchema]),
  setAgentAuth: z.tuple([agentAuthSchema]),
  signInSubscription: z.tuple([localeSchema]),
  cancelSignIn: z.tuple([]),
  signOutSubscription: z.tuple([]),
  agentSkills: z.tuple([]),
  setSharedSkill: z.tuple([z.string().min(1).max(64), z.boolean()]),
  mcp: z.tuple([]),
  setMcpToolPolicy: z.tuple([
    mcpNameSchema,
    z.array(mcpNameSchema).min(1).max(1024),
    mcpToolPolicySchema,
  ]),
  saveMcpSecret: z.tuple([
    mcpNameSchema,
    mcpSecretNameSchema,
    z.string().trim().min(1).max(4096),
  ]),
  deleteMcpSecret: z.tuple([mcpNameSchema, mcpSecretNameSchema]),
  reconnectMcp: z.tuple([mcpNameSchema]),
  signInMcp: z.tuple([mcpNameSchema, localeSchema]),
  cancelMcpSignIn: z.tuple([]),
  signOutMcp: z.tuple([mcpNameSchema]),
  cacheUsage: z.tuple([]),
  clearCache: z.tuple([]),
  about: z.tuple([]),
  reveal: z.tuple([appLocationSchema]),
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
  appearance,
  applyAppearance,
  secrets,
  config,
  cache,
  home,
  locations,
  skillFolders,
  instructionsFile,
  applySettings,
  marketData,
  liveCandles,
  agent,
  mcp,
}: Services) {
  // Paths are shown with the home folder as `~`.
  const tildify = (path: string) => path.replace(home, "~");

  handle("appearance", async () => appearance());

  handle("setTheme", async (theme) => {
    config.set(["appearance", "theme"], theme);
    applyAppearance();
  });

  handle("setPalette", async (scheme, palette) => {
    config.set(["appearance", "palette", scheme], palette);
    applyAppearance();
  });

  handle("setPriceColors", async (priceColors) => {
    config.set(["appearance", "priceColors"], priceColors);
    applyAppearance();
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
      warnings: catalog.warnings.map(tildify),
      instructions: instructions ? { characters: instructions.length } : null,
      paths: {
        skills: tildify(skillFolders.solyx),
        shared: tildify(skillFolders.shared),
        instructions: tildify(instructionsFile),
      },
    };
  });

  handle("setSharedSkill", async (name, enabled) => {
    const current = config.read().agent.sharedSkills;

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
  });

  handle("setMcpToolPolicy", async (server, tools, policy) => {
    config.update(
      tools.map((tool) => [
        ["agent", "mcpTools", mcpToolKey(server, tool)],
        policy,
      ])
    );
  });

  // A server reads its secrets as it connects, so a changed one reconnects it.
  handle("saveMcpSecret", async (server, name, value) => {
    await secrets.save(mcpSecretKey(name), value);
    mcp.reconnect(server);
  });

  handle("deleteMcpSecret", async (server, name) => {
    await secrets.delete(mcpSecretKey(name));
    mcp.reconnect(server);
  });

  handle("reconnectMcp", async (server) => mcp.reconnect(server));

  handle("signInMcp", (server, locale) => mcp.signIn(server, locale));

  handle("cancelMcpSignIn", async () => mcp.cancelSignIn());

  handle("signOutMcp", (server) => mcp.signOut(server));

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
    locations: mapValues(locations, tildify),
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
