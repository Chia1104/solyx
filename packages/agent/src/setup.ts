import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import * as z from "zod";

import { checkedFirst } from "./approval.ts";
import type { ToolGuard } from "./approval.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName, changeSettingArgumentsSchema } from "./wire.ts";
import type { SettingChange } from "./wire.ts";

/** One setting as the settings page shows it. */
export interface SetupSetting {
  /** Its entry in the config file, such as `agent.thinking`, or what the settings page calls it. */
  name: string;
  /** A key or a sign-in reads only as saved or missing, never as its value. */
  value: string;
  description?: string;
  /** What `change_setting` takes for it, worded for the model; left out where only the user changes it. */
  accepts?: string;
}

/** What the user sets up together on one settings tab. */
export interface SetupArea {
  name: string;
  /** The tab as a link into the app, which a reply may carry. */
  link: string;
  /** What keeps the area from working, worded for the model; empty while it works. */
  missing: string[];
  settings: SetupSetting[];
}

export interface SetupPort {
  read(): Promise<SetupArea[]>;
  /** Refuses a change the agent may not make, with what the setting takes, worded for the model. */
  check(change: SettingChange): Promise<void>;
  /** Makes a change `check` lets through, checking it again first. */
  change(change: SettingChange): Promise<void>;
}

export interface SetupToolsOptions {
  setup: SetupPort;
  guard: ToolGuard;
}

function settingText({ name, value, description, accepts }: SetupSetting) {
  return [
    `- ${name}: ${value}`,
    ...(description ? [` (${description})`] : []),
    ...(accepts ? [`; change_setting takes ${accepts}`] : []),
  ].join("");
}

function areaText(area: SetupArea): string[] {
  return [
    "",
    `## ${area.name} (link: ${area.link})`,
    ...area.missing.map((line) => `Missing: ${line}`),
    ...area.settings.map(settingText),
  ];
}

/**
 * `get_setup`: what the user has set up in the app and what is missing, as the host's settings
 * page shows it, and `change_setting`, which changes one the host lets the agent change once the
 * user allows it. No key or token reaches either.
 */
export function createSetupTools({
  setup,
  guard,
}: SetupToolsOptions): Extension {
  const changeSetting = defineTool({
    name: AgentToolName.ChangeSetting,
    // Saving the same value again changes nothing.
    replay: "safe",
    description:
      "Changes one setting to a value get_setup says change_setting takes for it, once the user allows it. The user sees the setting and the value as you pass them. Keys, sign-ins, the providers switched on, endpoints, the shell, MCP tools, shared skills and memory only the user changes, on their tab.",
    parameters: changeSettingArgumentsSchema,
    async execute(change) {
      await setup.change(change);

      return { text: `${change.setting} is now ${change.value}.` };
    },
  });

  return defineExtension({
    name: "solyx-setup",
    tools: [
      defineTool({
        name: AgentToolName.GetSetup,
        replay: "safe",
        description:
          "What the user has set up in Solyx and what is missing, by settings tab: data sources, the agent's models, web search, the decisions model, skills, memory, MCP servers and the app's version, and which settings change_setting takes. Keys, tokens and sign-ins read only as saved or missing. Read it before you explain why something does not work, how to set something up or change a setting, rather than guess.",
        parameters: z.object({}),
        async execute() {
          const areas = await setup.read();

          return {
            text: [
              "Solyx setup by settings tab. Link a tab in your reply as a markdown link to its link, named as the app names it in the reply's language.",
              ...areas.flatMap(areaText),
            ].join("\n"),
          };
        },
      }),
      checkedFirst(
        guard(changeSetting),
        changeSettingArgumentsSchema,
        (change) => setup.check(change)
      ),
    ],
  });
}
