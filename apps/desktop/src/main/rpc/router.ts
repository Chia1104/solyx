import { accountRouter } from "../modules/account/account.route.ts";
import { inboxRouter } from "../modules/inbox/inbox.route.ts";
import { proposalsRouter } from "../modules/proposals/proposals.route.ts";

import { contractOS } from "./context.ts";

export const router = contractOS.router({
  account: accountRouter,
  inbox: inboxRouter,
  proposals: proposalsRouter,
});
