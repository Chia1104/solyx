import { accountContract } from "./account.contract.ts";
import { inboxContract } from "./inbox.contract.ts";
import { proposalsContract } from "./proposals.contract.ts";

/** Everything a window can ask of the main process, one key per module. */
export const routerContract = {
  account: accountContract,
  inbox: inboxContract,
  proposals: proposalsContract,
};
