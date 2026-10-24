import { accountContract } from "./account.contract.ts";
import { agentContract } from "./agent.contract.ts";
import { backtestsContract } from "./backtests.contract.ts";
import { backupContract } from "./backup.contract.ts";
import { calendarContract } from "./calendar.contract.ts";
import { devicesContract } from "./devices.contract.ts";
import { embeddingsContract } from "./embeddings.contract.ts";
import { flowsContract } from "./flows.contract.ts";
import { fundamentalsContract } from "./fundamentals.contract.ts";
import { inboxContract } from "./inbox.contract.ts";
import { macroContract } from "./macro.contract.ts";
import { marketContract } from "./market.contract.ts";
import { memoryContract } from "./memory.contract.ts";
import { newsContract } from "./news.contract.ts";
import { proposalsContract } from "./proposals.contract.ts";
import { researchContract } from "./research.contract.ts";
import { schedulesContract } from "./schedules.contract.ts";
import { settingsContract } from "./settings.contract.ts";
import { storageContract } from "./storage.contract.ts";
import { themesContract } from "./themes.contract.ts";
import { updatesContract } from "./updates.contract.ts";
import { watchlistContract } from "./watchlist.contract.ts";
import { workspaceContract } from "./workspace.contract.ts";

/** Everything a window can ask of the main process, one key per module. */
export const routerContract = {
  account: accountContract,
  agent: agentContract,
  backtests: backtestsContract,
  backup: backupContract,
  calendar: calendarContract,
  devices: devicesContract,
  embeddings: embeddingsContract,
  flows: flowsContract,
  fundamentals: fundamentalsContract,
  inbox: inboxContract,
  macro: macroContract,
  market: marketContract,
  memory: memoryContract,
  news: newsContract,
  proposals: proposalsContract,
  research: researchContract,
  schedules: schedulesContract,
  settings: settingsContract,
  storage: storageContract,
  themes: themesContract,
  updates: updatesContract,
  watchlist: watchlistContract,
  workspace: workspaceContract,
};
