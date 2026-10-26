import type { Context } from "@earendil-works/chord";
import { defineExtension, section } from "@earendil-works/pi-durable";
import type {
  Extension,
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import * as z from "zod";

import type {
  BacktestOptions,
  RuleStrategy,
  StrategyLines,
} from "@solyx/core/backtest";
import type { Candle } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import { StrategyApprover } from "@solyx/core/strategy";
import type {
  StrategyApproval,
  StrategyManifest,
  StrategyParams,
  StrategyReach,
} from "@solyx/core/strategy";

import { ApprovalDoc } from "./approval.ts";
import type { AutoCheck, ToolGuard } from "./approval.ts";
import { defineTool } from "./tools.ts";
import {
  AgentToolName,
  allowStrategyArgumentsSchema,
  getStrategyArgumentsSchema,
} from "./wire.ts";

/** A strategy the user wrote, as its folder holds it now. */
export interface StrategyView extends StrategyManifest {
  /** What its STRATEGY.md says below the frontmatter. */
  notes: string;
  /** Its files as they are now, which any change to them leaves behind. */
  version: string;
  /** Each file with what it holds, `null` for one that is not text. */
  files: { path: string; bytes: number; text: string | null }[];
  /** The approval that lets it run where it would now, if one does. */
  allowed: StrategyApproval | null;
}

/** What a strategy's code worked out for a backtest of the same bars. */
export interface WorkedLines {
  rules: RuleStrategy;
  /** Each set of numbers, those not given at their initial values. */
  params: StrategyParams[];
  /** Each set's lines, in the same order. */
  lines: StrategyLines[];
  /** Where the code read bars after one it worked a line out for, at the time of the first. */
  lookAhead: { line: string; time: string } | null;
}

/** How likely a strategy's code does each thing that makes it unsafe to allow unasked, each from 0 to 1. */
export type CodeRisks = Readonly<Record<string, number>>;

/** The user's strategies, as the host reads, allows and runs them. */
export interface StrategiesPort {
  /** Every strategy as its folder is now, where code would run, and what keeps a folder from being one. */
  catalog(): Promise<{
    strategies: StrategyView[];
    reach: StrategyReach;
    problems: string[];
  }>;
  /** Refused unless the strategy, as its files are now, may run where it would. */
  lines(
    name: string,
    symbol: SymbolRef,
    candles: readonly Candle[],
    bars: Pick<BacktestOptions, "interval" | "daily">,
    params: readonly Readonly<StrategyParams>[]
  ): Promise<WorkedLines>;
  approve(
    name: string,
    version: string,
    by: StrategyApprover
  ): Promise<StrategyApproval>;
  /** What the decisions model makes of a strategy's code; `undefined` while the user has set up no model. */
  judge(
    strategy: StrategyView,
    signal: AbortSignal | undefined
  ): Promise<CodeRisks | undefined>;
}

// Measured with `packages/decisions/scripts/eval-code.ts`: no unsafe sample scored below it.
const AUTO_THRESHOLD = 0.3;

// What `get_strategy` shows of each file's text, so one long file leaves room for the rest.
const MAX_FILE_TEXT = 12_000;

const shortVersion = (version: string) => version.slice(0, 12);

const where = (reach: StrategyReach) =>
  reach.sandboxed
    ? "in the sandbox"
    : `outside the sandbox, with the user's own access${reach.live ? ", beside a live account" : ""}`;

const paramsText = (params: StrategyManifest["params"]) =>
  Object.entries(params)
    .map(
      ([name, { min, max, step, initial }]) =>
        `${name} ${min}–${max} by ${step}, from ${initial}`
    )
    .join("; ") || "none";

function strategiesText(
  strategies: readonly StrategyView[],
  reach: StrategyReach
) {
  if (strategies.length === 0) return "";

  return [
    "# Strategies",
    `The user wrote these in the app's config folder: code in any language that works out lines from a listing's bars, and rules over those lines that the app's engine trades on, as it trades backtest.rules. Run one with run_analysis's strategies functions, which read the bars themselves; its code runs ${where(reach)}. A version of a strategy's files runs only once allowed: where a function says it is not, call allow_strategy with the version get_strategy gives, which may ask the user. The code is the user's, and so is how healthy it is: say what a run's lookAhead names, the line and the first bar its code read later bars for, whenever you cite that run.`,
    ...strategies.map(
      (strategy) =>
        `- ${strategy.name}: ${strategy.description} Numbers: ${paramsText(strategy.params)}. ${strategy.allowed ? "Allowed." : "Not allowed yet."}`
    ),
  ].join("\n");
}

/** Who let `api`'s call through the approval gate: the user, the conversation's check, or its mode. */
const approverOf = (api: ToolExecutionApi, context: Context) =>
  api.commit(async (tx) => {
    const record = await tx.doc(ApprovalDoc, api.conversationId);

    if (record.answers[api.callId] === true) return StrategyApprover.User;

    return record.auto.includes(api.callId)
      ? StrategyApprover.Check
      : StrategyApprover.Mode;
  }, context);

/**
 * `get_strategy` reads a strategy the user wrote, and `allow_strategy` lets a version of its files
 * run once the user allows it, or the decisions model finds its code harmless in a conversation set
 * to auto. Outside the sandbox beside a live account only the user allows one, since code there
 * reaches what the desk keeps from the agent.
 */
export function createStrategyTools(strategies: StrategiesPort) {
  async function find(name: string) {
    const catalog = await strategies.catalog();
    const strategy = catalog.strategies.find((each) => each.name === name);

    if (!strategy) {
      const problem = catalog.problems.find(
        (each) =>
          each.includes(`${name}/STRATEGY.md:`) ||
          each.includes(`${name}\\STRATEGY.md:`)
      );

      throw new Error(
        problem ?? `No strategy is named ${name}; the prompt lists them`
      );
    }

    return { strategy, reach: catalog.reach };
  }

  const getStrategy = defineTool({
    name: AgentToolName.GetStrategy,
    replay: "safe",
    description:
      "Reads a strategy the user wrote: what it is for, the command its code runs by, the numbers it takes, the rules the engine trades on over its lines, its notes, each file's text, its version and whether that version may run where its code would now.",
    parameters: getStrategyArgumentsSchema,
    async execute({ name }) {
      const { strategy, reach } = await find(name);

      const files = strategy.files.map((file) =>
        file.text === null
          ? `--- ${file.path} (${file.bytes} bytes, not text) ---`
          : `--- ${file.path} ---\n${file.text.slice(0, MAX_FILE_TEXT)}${file.text.length > MAX_FILE_TEXT ? `\n… cut at ${MAX_FILE_TEXT} characters` : ""}`
      );

      return {
        text: [
          `${strategy.name}: ${strategy.description}`,
          `Runs by: ${strategy.run}, ${where(reach)}`,
          `Numbers: ${paramsText(strategy.params)}`,
          `Rules: ${JSON.stringify(strategy.rules)}`,
          `Version: ${strategy.version}`,
          strategy.allowed
            ? `Allowed by the ${strategy.allowed.by === StrategyApprover.User ? "user" : strategy.allowed.by === StrategyApprover.Check ? "decisions model" : "conversation's mode"}.`
            : "Not allowed yet: call allow_strategy with this version to run it.",
          ...(strategy.notes ? ["", strategy.notes] : []),
          "",
          ...files,
        ].join("\n"),
        details: { name, version: strategy.version },
      };
    },
  });

  const allowStrategy = defineTool({
    name: AgentToolName.AllowStrategy,
    // Allowing a version again keeps the same approval.
    replay: "safe",
    description:
      "Lets one version of a strategy's files run where its code would now, once the user allows it, or in a conversation set to auto once the decisions model finds the code harmless. Pass the version get_strategy gave: a version the files have since left is refused.",
    parameters: allowStrategyArgumentsSchema,
    async execute({ name, version }, api, context) {
      const by = await approverOf(api, context);
      const { reach } = await find(name);

      if (!reach.sandboxed && reach.live && by !== StrategyApprover.User) {
        throw new Error(
          "Outside the sandbox beside a live account only the user allows a strategy's code, and a conversation set to let every call run does not count: ask the user to allow it themselves"
        );
      }

      const approval = await strategies.approve(name, version, by);

      return {
        text: `${name} may now run as its files are (version ${shortVersion(version)}), ${approval.outside ? "outside the sandbox" : "in the sandbox"}.`,
        details: { name, version },
      };
    },
  });

  /** In a conversation set to auto, a version is allowed unasked only when every risk is unlikely. */
  const harmless: AutoCheck = async (args, _api, context) => {
    const parsed = allowStrategyArgumentsSchema.safeParse(args);

    if (!parsed.success) return false;

    const { strategy, reach } = await find(parsed.data.name);

    // The model's judgement does not count there, so the user is asked.
    if (!reach.sandboxed && reach.live) return false;

    if (strategy.version !== parsed.data.version) return false;

    const risks = Object.values(
      (await strategies.judge(strategy, context.abortSignal)) ?? {}
    );

    return risks.length > 0 && risks.every((risk) => risk < AUTO_THRESHOLD);
  };

  /**
   * Checks a call before the user is asked, and answers one for a version already allowed without
   * asking, so they are never asked about a version that cannot run or already may.
   */
  function asking(guarded: ToolRegistration): ToolRegistration {
    return {
      ...guarded,
      async execute(params, api, context) {
        const parsed = allowStrategyArgumentsSchema.safeParse(params);

        if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

        const { strategy } = await find(parsed.data.name);

        if (strategy.version !== parsed.data.version) {
          throw new Error(
            `${strategy.name}'s files are now version ${strategy.version}; read them again with get_strategy before allowing it`
          );
        }

        if (strategy.allowed) {
          return {
            output: [
              {
                type: "text",
                text: `${strategy.name} may already run as its files are.`,
              },
            ],
            details: { name: strategy.name, version: strategy.version },
          };
        }

        return guarded.execute(params, api, context);
      },
    };
  }

  return {
    /** The tools and the prompt's list of strategies, a version waiting for the user through `guard`. */
    extension: (guard: ToolGuard): Extension =>
      defineExtension({
        name: "solyx-strategies",
        tools: [getStrategy, asking(guard(allowStrategy, harmless))],
        sections: [
          section(
            "strategies",
            async () => {
              const { strategies: listed, reach } = await strategies.catalog();

              return strategiesText(listed, reach);
            },
            { tag: false }
          ),
        ],
      }),
  };
}
