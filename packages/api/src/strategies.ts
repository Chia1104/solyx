import * as z from "zod";

import { strategyNameSchema } from "@solyx/core/strategy";
import type { StrategyManifest } from "@solyx/core/strategy";

/** Who let a version of a strategy's code run. */
export const StrategyApprover = {
  /** The user, in one of the app's windows or answering the agent's call. */
  User: "user",
  /** The decisions model, judging the code for a conversation set to auto. */
  Check: "check",
  /** A conversation the user set to let every call run unasked. */
  Mode: "mode",
} as const;

export type StrategyApprover =
  (typeof StrategyApprover)[keyof typeof StrategyApprover];

/** That one version of a strategy's code may run, and where. */
export const strategyApprovalSchema = z.strictObject({
  name: strategyNameSchema,
  /** The strategy's files as they were allowed, which any change to them leaves behind. */
  version: z.string(),
  by: z.enum(StrategyApprover),
  /** Allowed to run outside the sandbox, as it then would have. */
  outside: z.boolean(),
  /** In milliseconds since the epoch. */
  at: z.number(),
});

export type StrategyApproval = z.infer<typeof strategyApprovalSchema>;

/** Where a strategy's code would run now. */
export interface StrategyReach {
  /** In the app's sandbox, which this system has and the user keeps on. */
  sandboxed: boolean;
  /** Beside a live account at a broker. */
  live: boolean;
}

/**
 * Whether `approval` lets its version run where `reach` says: anywhere in the sandbox; outside it
 * only where it was allowed to run there, and beside a live account only where the user allowed
 * that themselves, since unsandboxed code reaches what the desk keeps from the agent.
 */
export function approvalAllows(
  approval: StrategyApproval,
  reach: StrategyReach
) {
  if (reach.sandboxed) return true;

  if (!approval.outside) return false;

  return !reach.live || approval.by === StrategyApprover.User;
}

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
