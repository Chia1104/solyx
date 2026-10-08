import "./app/zod-config.ts";
import "./app/i18n.ts";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { queryClient } from "./app/query-client.ts";
import { router } from "./app/router.tsx";
import { followAppearance } from "./app/theme.ts";
import { followAgentEvents } from "./modules/agent/agent-events.ts";
import { followMarketDataChanges } from "./modules/market/market-sessions-query.ts";
import { followAfterHours } from "./modules/market/quote-query.ts";
import { followMemoryChanges } from "./modules/memory/memory-query.ts";
import { followNewsChanges } from "./modules/news/news-query.ts";
import { followProposalChanges } from "./modules/proposals/proposals-query.ts";
import { followResearchChanges } from "./modules/research/research-query.ts";
import { followSettingsChanges } from "./modules/settings/settings-query.ts";
import { followUpdateChanges } from "./modules/updates/updates-query.ts";

// Followed for the window's whole life, so a query that never goes stale on its own hears of
// every change, whichever page is open.
for (const follow of [
  followAgentEvents,
  followAfterHours,
  followMarketDataChanges,
  followMemoryChanges,
  followNewsChanges,
  followProposalChanges,
  followResearchChanges,
  followSettingsChanges,
  followUpdateChanges,
]) {
  follow(queryClient);
}

await followAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
