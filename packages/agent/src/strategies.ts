import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  defineExtension,
  section,
} from "@earendil-works/pi-durable";
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
import { StrategyApprover, approvalAllows } from "@solyx/core/strategy";
import type {
  LookAheadAt,
  StrategyApproval,
  StrategyChange,
  StrategyManifest,
  StrategyParams,
  StrategyReach,
  StrategyRuntime,
} from "@solyx/core/strategy";

import { ApprovalDoc } from "./approval.ts";
import type { AutoCheck, ToolGuard } from "./approval.ts";
import { defineTool } from "./tools.ts";
import {
  AgentToolName,
  allowStrategyArgumentsSchema,
  getStrategyArgumentsSchema,
  saveStrategyArgumentsSchema,
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
  lookAhead: LookAheadAt | null;
}

/** How likely a strategy's code does each thing that makes it unsafe to allow unasked, each from 0 to 1. */
export type CodeRisks = Readonly<Record<string, number>>;

/** What a strategy's code is, as the decisions model judges it. */
export type StrategyCode = Pick<StrategyView, "name" | "run" | "files">;

/** What a change would make of a strategy's files. */
export interface StrategyDraft {
  /** The version its files are now, `null` for a strategy not yet written. */
  current: string | null;
  /** The strategy they would then be. */
  draft: StrategyCode & { version: string };
}

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
    strategy: StrategyCode,
    signal: AbortSignal | undefined
  ): Promise<CodeRisks | undefined>;
  /**
   * What `change` would make of the version `basedOn` of `name`'s files, `undefined` for a strategy
   * not yet written: refused where it would not read as a strategy, or the files left that version.
   */
  draft(
    name: string,
    basedOn: string | undefined,
    change: StrategyChange
  ): Promise<StrategyDraft>;
  /** Makes `change` as `draft` checks it, and gives the version the files then are. */
  save(
    name: string,
    basedOn: string | undefined,
    change: StrategyChange
  ): Promise<string>;
  /** The interpreters a strategy's code finds where it would run now. */
  runtimes(signal: AbortSignal | undefined): Promise<StrategyRuntime[]>;
}

/** The version of each strategy a conversation's `save_strategy` last wrote, by name. */
const SavedStrategiesDoc = defineDoc<{ saved: Record<string, string> }>({
  kind: "solyx.saved-strategies",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ saved: {} }),
  checkpointWhen: (_value, _ops, { deltasSinceBase }) => deltasSinceBase >= 64,
});

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
    `The user wrote these in the app's config folder: code in any language that works out lines from a listing's bars, and rules over those lines that the app's engine trades on, as it trades backtest.rules. Run one with run_analysis's strategies functions, which read the bars themselves; its code runs ${where(reach)}. A version of a strategy's files runs only once allowed: where a function says it is not, call allow_strategy with the version get_strategy gives, which may ask the user. Change one with save_strategy, as the strategy skill says. The code is the user's, and so is how healthy it is: say what a run's lookAhead names, the line and the first bar its code read later bars for, whenever you cite that run.`,
    ...strategies.map(
      (strategy) =>
        `- ${strategy.name}: ${strategy.description} Numbers: ${paramsText(strategy.params)}. ${strategy.allowed ? "Allowed." : "Not allowed yet."}`
    ),
  ].join("\n");
}

/** What a strategy's code finds where it would run now, as `get_runtimes` tells the model. */
function runtimesText(
  runtimes: readonly StrategyRuntime[],
  reach: StrategyReach
) {
  const place = reach.sandboxed
    ? "in the sandbox, where it reads its own files and the tools on its PATH, writes only its run's folder and reaches no network, so nothing it needs can be downloaded as it runs"
    : `outside the sandbox, with the user's own access${reach.live ? ", beside a live account" : ""}`;

  if (runtimes.length === 0) {
    return `A strategy's code would run ${place}, and finds no interpreter there: the user installs one, such as Python, before any strategy can run.`;
  }

  return [
    `A strategy's code would run ${place}, and finds these interpreters, which its run names as listed here:`,
    ...runtimes.map(({ command, version, packages }) => {
      const installed = Object.entries(packages).map(
        ([name, at]) => `${name} ${at}`
      );

      const python = command.startsWith("python")
        ? installed.length > 0
          ? `, with ${installed.join(", ")}`
          : ", with none of the packages strategies use most, such as numpy or pandas, so its standard library alone"
        : "";

      return `- ${command}: ${version}${python}`;
    }),
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
 * `get_strategy` reads a strategy the user wrote, `save_strategy` writes one, `get_runtimes` says
 * what its code would run on, and `allow_strategy` lets a version of its files run once the user
 * allows it, or the decisions model finds its code harmless in a conversation set to auto. Outside
 * the sandbox beside a live account only the user allows one, since code there reaches what the
 * desk keeps from the agent.
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

  const saveStrategy = defineTool({
    name: AgentToolName.SaveStrategy,
    // Saving the same files again changes nothing, and allows the same version again.
    replay: "safe",
    description:
      "Writes a strategy into the user's strategies folder, as the strategy skill says: whole text files, STRATEGY.md and the code for a new one, and files to remove, then lets the version that makes run where its code would now. The user reads the change and allows it, unless the conversation lets it run: in one set to auto, a new strategy or one this conversation wrote runs unasked once the decisions model finds its code harmless, and a change to any other always asks. To change a strategy, pass the version get_strategy gave: files that have since changed are refused.",
    parameters: saveStrategyArgumentsSchema,
    async execute({ name, version: basedOn, files, remove }, api, context) {
      const by = await approverOf(api, context);
      const { reach } = await strategies.catalog();
      const version = await strategies.save(name, basedOn, { files, remove });

      await api.commit(async (tx) => {
        const doc = await tx.doc(SavedStrategiesDoc, api.conversationId);

        doc.saved = { ...doc.saved, [name]: version };
      }, context);

      const allows = approvalAllows(
        { name, version, by, outside: !reach.sandboxed, at: 0 },
        reach
      );

      if (!allows) {
        return {
          text: `Saved ${name} as version ${version}. Outside the sandbox beside a live account only the user allows a strategy's code, so it runs once they allow it themselves, in the backtest panel or answering allow_strategy.`,
          details: { name, version },
        };
      }

      await strategies.approve(name, version, by);

      return {
        text: `Saved ${name} as version ${version}, which may now run ${where(reach)}.`,
        details: { name, version },
      };
    },
  });

  const getRuntimes = defineTool({
    name: AgentToolName.GetRuntimes,
    replay: "safe",
    description:
      "Says which interpreters a strategy's code finds on its PATH where it would run now, each with its version, and the packages strategies use most that its Python has, by asking each as the code would run. Read it before writing a strategy, so its code runs on what is there.",
    parameters: z.object({}),
    async execute(_args, _api, context) {
      const [{ reach }, runtimes] = await Promise.all([
        strategies.catalog(),
        strategies.runtimes(context.abortSignal),
      ]);

      return { text: runtimesText(runtimes, reach) };
    },
  });

  /** The version of `name` this conversation's `save_strategy` last wrote, if any. */
  const savedHere = (name: string, api: ToolExecutionApi, context: Context) =>
    api.commit(
      async (tx) =>
        (await tx.doc(SavedStrategiesDoc, api.conversationId)).saved[name],
      context
    );

  /**
   * In a conversation set to auto, a change is saved unasked only to a strategy not yet written or
   * whose files are as this conversation last wrote them, and only once every risk in the code it
   * would make is unlikely: a change to any other writes over the user's own work.
   */
  const ownWork: AutoCheck = async (args, api, context) => {
    const parsed = saveStrategyArgumentsSchema.safeParse(args);

    if (!parsed.success) return false;

    const { name, version, files, remove } = parsed.data;
    const { reach } = await strategies.catalog();

    // The model's judgement does not count there, so the user is asked.
    if (!reach.sandboxed && reach.live) return false;

    const { current, draft } = await strategies.draft(name, version, {
      files,
      remove,
    });

    if (current !== null && (await savedHere(name, api, context)) !== current) {
      return false;
    }

    const risks = Object.values(
      (await strategies.judge(draft, context.abortSignal)) ?? {}
    );

    return risks.length > 0 && risks.every((risk) => risk < AUTO_THRESHOLD);
  };

  /**
   * Checks a change before the user is asked, so they are never asked about one that cannot be
   * made, and answers one that leaves an allowed strategy as it is without asking.
   */
  function drafting(guarded: ToolRegistration): ToolRegistration {
    return {
      ...guarded,
      async execute(params, api, context) {
        const parsed = saveStrategyArgumentsSchema.safeParse(params);

        if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

        const { name, version, files, remove } = parsed.data;

        const { current, draft } = await strategies.draft(name, version, {
          files,
          remove,
        });

        if (draft.version === current) {
          const listed = (await strategies.catalog()).strategies.find(
            (each) => each.name === name
          );

          if (listed?.allowed) {
            return {
              output: [
                {
                  type: "text",
                  text: `${name}'s files are already so, and that version may run.`,
                },
              ],
              details: { name, version: current },
            };
          }
        }

        return guarded.execute(params, api, context);
      },
    };
  }

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
    /**
     * The tools and the prompt's list of strategies, a save or a version waiting for the user
     * through `guard`. Reading and allowing one are offered only where the user has some.
     */
    extension: (guard: ToolGuard, listed: boolean): Extension =>
      defineExtension({
        name: "solyx-strategies",
        tools: [
          drafting(guard(saveStrategy, ownWork)),
          getRuntimes,
          ...(listed
            ? [getStrategy, asking(guard(allowStrategy, harmless))]
            : []),
        ],
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
