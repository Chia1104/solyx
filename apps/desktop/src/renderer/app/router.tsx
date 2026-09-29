import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import * as z from "zod";

import { Interval, intervalSchema } from "@solyx/core/candles";
import { symbolRefSchema } from "@solyx/core/market";

import { ErrorFallback } from "../components/error-fallback.tsx";
import { OverviewPage } from "../pages/overview-page.tsx";
import { ProposalsPage } from "../pages/proposals-page.tsx";
import { SettingsPage } from "../pages/settings-page.tsx";
import { SymbolPage } from "../pages/symbol-page.tsx";

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

// A missing or unknown interval falls back to daily bars instead of failing the page.
const symbolSearchSchema = z.object({
  interval: intervalSchema.default(Interval.OneDay).catch(Interval.OneDay),
});

const symbolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "symbol/$market/$symbol",
  params: { parse: (params) => symbolRefSchema.parse(params) },
  validateSearch: symbolSearchSchema,
  component: SymbolPage,
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
    symbolRoute,
    settingsRoute,
  ]),
  history: createHashHistory(),
  defaultErrorComponent: ErrorFallback,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
