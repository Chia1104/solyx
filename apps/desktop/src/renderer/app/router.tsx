import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { OverviewPage } from "../pages/overview-page.tsx";
import { ProposalsPage } from "../pages/proposals-page.tsx";
import { SettingsPage } from "../pages/settings-page.tsx";

import { RootLayout } from "./root-layout.tsx";

const rootRoute = createRootRoute({ component: RootLayout });

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});

const proposalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "proposals",
  component: ProposalsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage,
});

/** Builds load from file://, so routes live in the hash to survive reloads and open in new windows. */
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    overviewRoute,
    proposalsRoute,
    settingsRoute,
  ]),
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
