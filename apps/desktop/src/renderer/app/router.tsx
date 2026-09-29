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
import { NotFound } from "../components/not-found.tsx";
import {
  SettingsSection,
  settingsSectionSchema,
} from "../modules/settings/settings-section.ts";
import { OverviewPage } from "../pages/overview-page.tsx";
import { SettingsPage } from "../pages/settings-page.tsx";
import { SymbolPage } from "../pages/symbol-page.tsx";

import { RootLayout } from "./root-layout.tsx";

const rootRoute = createRootRoute({ component: RootLayout });

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});

// A missing or unknown interval falls back to daily bars instead of failing the page.
const symbolSearchSchema = z.object({
  interval: intervalSchema.default(Interval.OneDay).catch(Interval.OneDay),
});

const symbolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "symbol/$market/$symbol",
  // An address naming no valid listing matches no route, so it lands on the not-found page.
  params: {
    parse: (params) => symbolRefSchema.safeParse(params).data ?? false,
  },
  validateSearch: symbolSearchSchema,
  component: SymbolPage,
});

// An unknown tab falls back to the first rather than failing the page.
const settingsSearchSchema = z.object({
  section: settingsSectionSchema
    .default(SettingsSection.General)
    .catch(SettingsSection.General),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  validateSearch: settingsSearchSchema,
  component: SettingsPage,
});

/** Builds load from file://, so routes live in the hash to survive reloads and open in new windows. */
export const router = createRouter({
  routeTree: rootRoute.addChildren([overviewRoute, symbolRoute, settingsRoute]),
  history: createHashHistory(),
  defaultErrorComponent: ErrorFallback,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
