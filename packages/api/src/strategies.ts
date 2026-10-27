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
  /** A digest of what it holds, which tells two versions of a file apart whether or not it is text. */
  digest: string;
}

/** A strategy as a window lists it. */
export interface StrategyEntry extends StrategyManifest {
  /** What its STRATEGY.md says below the frontmatter. */
  notes: string;
  version: string;
  files: StrategyFile[];
  /** Whether its code may run where it would now, and the approval that lets it. */
  allowed: StrategyApproval | null;
  /** Every approval of its versions kept, newest first, whether or not one lets it run now. */
  approvals: StrategyApproval[];
}

/** The strategies the user wrote, and what keeps any other folder from being one. */
export interface StrategyCatalog {
  strategies: StrategyEntry[];
  reach: StrategyReach;
  /** Each a folder and why it holds no strategy the app can run. */
  problems: string[];
}

/** One version of a strategy's files, each with what it says where it is text. */
export interface StrategyVersionFiles {
  version: string;
  files: (StrategyFile & { text: string | null })[];
}

/** A strategy's files as they are now, beside those of the version allowed before them, if any. */
export interface StrategyReview {
  name: string;
  current: StrategyVersionFiles;
  previous: StrategyVersionFiles | null;
}

/** The strategies page in the router's hash, or one strategy's, which the agent's replies link to. */
export const strategiesLink = (name?: string) =>
  name === undefined ? "#/strategies" : `#/strategies/${name}`;

/** Allowing one version of a strategy from a window, as the user. */
export const strategyApproveSchema = z.strictObject({
  name: strategyNameSchema,
  version: z.string(),
});
