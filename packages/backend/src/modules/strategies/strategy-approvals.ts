import * as z from "zod";

import { STRATEGY_APPROVALS_SECRET } from "@solyx/api/settings";
import { strategyApprovalSchema } from "@solyx/core/strategy";
import type { StrategyApproval } from "@solyx/core/strategy";
import { parseJson } from "@solyx/utils/json";

import type { SecretStore } from "../settings/secret-store.ts";

/** The most versions of one strategy kept allowed, newest first, so editing back and forth asks once. */
export const KEPT_VERSIONS = 8;

const approvalsSchema = z.array(strategyApprovalSchema);

/**
 * The versions of the user's strategies allowed to run, sealed with the secrets, so no edit of the
 * app's files allows one. Read afresh each time, since a run is rare beside a decryption.
 */
export function createStrategyApprovals(secrets: SecretStore) {
  async function read(): Promise<StrategyApproval[]> {
    const sealed = await secrets.get(STRATEGY_APPROVALS_SECRET);

    return sealed === undefined
      ? []
      : (parseJson(sealed, approvalsSchema) ?? []);
  }

  const write = (approvals: readonly StrategyApproval[]) =>
    approvals.length === 0
      ? secrets.delete(STRATEGY_APPROVALS_SECRET)
      : secrets.save(STRATEGY_APPROVALS_SECRET, JSON.stringify(approvals));

  return {
    /** Every approval kept, newest first. */
    list: read,

    /** Keeps `approval`, in place of one of the same version and place to run, newest first. */
    async approve(approval: StrategyApproval) {
      const kept = (await read()).filter(
        (each) =>
          !(
            each.name === approval.name &&
            each.version === approval.version &&
            each.by === approval.by &&
            each.outside === approval.outside
          )
      );

      const others = kept.filter((each) => each.name !== approval.name);

      const versions = [approval.version];

      // A strategy keeps its newest versions, each with every approval it had.
      const own = kept.filter((each) => {
        if (each.name !== approval.name) return false;

        if (!versions.includes(each.version)) versions.push(each.version);

        return versions.indexOf(each.version) < KEPT_VERSIONS;
      });

      await write([approval, ...own, ...others]);
    },

    /** Takes back every version of `name`. */
    async revoke(name: string) {
      await write((await read()).filter((each) => each.name !== name));
    },
  };
}

export type StrategyApprovals = ReturnType<typeof createStrategyApprovals>;
