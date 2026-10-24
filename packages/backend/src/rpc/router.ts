import { accountRouter } from "../modules/account/account.route.ts";
import { agentRouter } from "../modules/agent/agent.route.ts";
import { backtestsRouter } from "../modules/backtests/backtests.route.ts";
import { backupRouter } from "../modules/backup/backup.route.ts";
import { calendarRouter } from "../modules/calendar/calendar.route.ts";
import { devicesRouter } from "../modules/devices/devices.route.ts";
import { embeddingsRouter } from "../modules/embeddings/embeddings.route.ts";
import { flowsRouter } from "../modules/flows/flows.route.ts";
import { fundamentalsRouter } from "../modules/fundamentals/fundamentals.route.ts";
import { inboxRouter } from "../modules/inbox/inbox.route.ts";
import { macroRouter } from "../modules/macro/macro.route.ts";
import { marketRouter } from "../modules/market/market.route.ts";
import { memoryRouter } from "../modules/memory/memory.route.ts";
import { newsRouter } from "../modules/news/news.route.ts";
import { proposalsRouter } from "../modules/proposals/proposals.route.ts";
import { researchRouter } from "../modules/research/research.route.ts";
import { schedulesRouter } from "../modules/schedules/schedules.route.ts";
import { settingsRouter } from "../modules/settings/settings.route.ts";
import { storageRouter } from "../modules/storage/storage.route.ts";
import { themesRouter } from "../modules/themes/themes.route.ts";
import { updatesRouter } from "../modules/updates/updates.route.ts";
import { watchlistRouter } from "../modules/watchlist/watchlist.route.ts";
import { workspaceRouter } from "../modules/workspace/workspace.route.ts";

import { contractOS } from "./context.ts";

export const router = contractOS.router({
  account: accountRouter,
  agent: agentRouter,
  backtests: backtestsRouter,
  backup: backupRouter,
  calendar: calendarRouter,
  devices: devicesRouter,
  embeddings: embeddingsRouter,
  flows: flowsRouter,
  fundamentals: fundamentalsRouter,
  inbox: inboxRouter,
  macro: macroRouter,
  market: marketRouter,
  memory: memoryRouter,
  news: newsRouter,
  proposals: proposalsRouter,
  research: researchRouter,
  schedules: schedulesRouter,
  settings: settingsRouter,
  storage: storageRouter,
  themes: themesRouter,
  updates: updatesRouter,
  watchlist: watchlistRouter,
  workspace: workspaceRouter,
});
