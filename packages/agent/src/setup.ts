import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import * as z from "zod";

import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

/** One setting as the settings page shows it. */
export interface SetupSetting {
  /** Its entry in the config file, such as `agent.thinking`, or what the settings page calls it. */
  name: string;
  /** A key or a sign-in reads only as saved or missing, never as its value. */
  value: string;
  description?: string;
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
}

function areaText(area: SetupArea): string[] {
  return [
    "",
    `## ${area.name} (link: ${area.link})`,
    ...area.missing.map((line) => `Missing: ${line}`),
    ...area.settings.map(
      ({ name, value, description }) =>
        `- ${name}: ${value}${description ? ` (${description})` : ""}`
    ),
  ];
}

/**
 * `get_setup`: what the user has set up in the app and what is missing, as the host's settings
 * page shows it. It changes nothing, and no key or token reaches it.
 */
export function createSetupTools({ setup }: { setup: SetupPort }): Extension {
  return defineExtension({
    name: "solyx-setup",
    tools: [
      defineTool({
        name: AgentToolName.GetSetup,
        replay: "safe",
        description:
          "What the user has set up in Solyx and what is missing, by settings tab: data sources, the agent's models, web search, the decisions model, skills, memory, MCP servers and the app's version. Keys, tokens and sign-ins read only as saved or missing. Read it before you explain why something does not work or how to set something up, rather than guess.",
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
    ],
  });
}
