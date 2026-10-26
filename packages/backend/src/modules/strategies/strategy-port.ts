import { omit } from "es-toolkit";

import type { StrategiesPort, StrategyView } from "@solyx/agent/strategies";
import type { CodeJudge } from "@solyx/decisions/code";

import type { Strategies } from "./strategies.ts";
import { strategyTexts } from "./strategy-folder.ts";

/**
 * The user's strategies as the agent reads, allows and runs them: each with its files' text, and
 * the decisions model's judgement of its code, which reads every file as text or refuses.
 */
export function createStrategyPort(
  strategies: Strategies,
  codeJudge: () => Promise<CodeJudge | undefined>
): StrategiesPort {
  return {
    async catalog() {
      const { strategies: read, reach, problems } = await strategies.read();

      return {
        strategies: read.map(({ strategy, allowed }): StrategyView => ({
          ...strategy.manifest,
          notes: strategy.notes,
          version: strategy.version,
          files: strategyTexts(strategy),
          allowed,
        })),
        reach,
        problems,
      };
    },

    lines: (...args) => strategies.lines(...args),

    approve: (...args) => strategies.approve(...args),

    async judge(strategy, signal) {
      const judge = await codeJudge();

      if (judge === undefined) return undefined;

      const files = strategy.files.map(({ path, text }) => {
        if (text === null) {
          throw new Error(
            `${strategy.name} holds ${path}, which is not text the decisions model can read`
          );
        }

        return { path, text };
      });

      const judgement = await judge.judge(
        { command: strategy.run, files },
        { signal }
      );

      return omit(judgement, ["model"]);
    },
  };
}
