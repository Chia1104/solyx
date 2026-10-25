import * as z from "zod";

import { strategyNameSchema } from "@solyx/core/strategy";
import type {
  StrategyApproval,
  StrategyManifest,
  StrategyReach,
} from "@solyx/core/strategy";

/** One file of a strategy's folder. */
export interface StrategyFile {
  /** From the strategy's folder, with `/` between folders. */
  path: string;
  bytes: number;
}

/** A strategy as a window lists it. */
export interface StrategyEntry extends StrategyManifest {
  /** What its STRATEGY.md says below the frontmatter. */
  notes: string;
  version: string;
  files: StrategyFile[];
  /** Whether its code may run where it would now, and the approval that lets it. */
  allowed: StrategyApproval | null;
}

/** The strategies the user wrote, and what keeps any other folder from being one. */
export interface StrategyCatalog {
  strategies: StrategyEntry[];
  reach: StrategyReach;
  /** Each a folder and why it holds no strategy the app can run. */
  problems: string[];
}

/** Allowing one version of a strategy from a window, as the user. */
export const strategyApproveSchema = z.strictObject({
  name: strategyNameSchema,
  version: z.string(),
});
