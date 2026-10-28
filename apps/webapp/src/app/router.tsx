import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import * as z from "zod";

import { OverviewTab, overviewTabSchema } from "@solyx/api/overview-tab";
import { isMarketDataReady } from "@solyx/api/settings";
import {
  SettingsSection,
  settingsSectionSchema,
} from "@solyx/api/settings-section";
import { Interval, intervalSchema } from "@solyx/core/candles";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";
import { strategyNameSchema } from "@solyx/core/strategy";

import { ErrorFallback } from "../components/error-fallback.tsx";
import { NotFound } from "../components/not-found.tsx";
import { ChartKind, chartKindSchema } from "../modules/market/chart-kind.ts";
import { LowerView, lowerViewSchema } from "../modules/market/lower-view.ts";
import {
  OnboardingStep,
  onboardingStepSchema,
} from "../modules/onboarding/onboarding-step.ts";
import { useOnboardingStore } from "../modules/onboarding/onboarding-store.ts";
import { marketDataQuery } from "../modules/settings/settings-query.ts";
import { OnboardingPage } from "../pages/onboarding-page.tsx";
import { OverviewPage } from "../pages/overview-page.tsx";
import { SettingsPage } from "../pages/settings-page.tsx";
import { StrategiesPage } from "../pages/strategies-page.tsx";
import { StrategyPage } from "../pages/strategy-page.tsx";
import { SymbolPage } from "../pages/symbol-page.tsx";

import { inWindow } from "./device.ts";
import { queryClient } from "./query-client.ts";
import { RootLayout } from "./root-layout.tsx";

const rootRoute = createRootRoute({
  component: RootLayout,
  // First-run setup comes before the workspace until it is finished or skipped. Someone whose
  // market data already works, as after editing the config file by hand, never sees it.
  beforeLoad: async ({ location }) => {
    const onboarding = useOnboardingStore.getState();

    // A paired browser changes no settings, so it never sets the app up.
    if (!inWindow || onboarding.finished || location.pathname === "/onboarding")
      return;

    // A failed check never keeps anyone out of the app.
    const status = await queryClient
      .query(marketDataQuery())
      .catch(() => undefined);

    if (!status) return;

    if (isMarketDataReady(status)) {
      onboarding.finish();

      return;
    }

    throw redirect({ to: "/onboarding" });
  },
});

// Settings and first-run setup are this computer's own windows' to change.
const keepToWindows = () => {
  if (!inWindow) throw redirect({ to: "/" });
};

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "onboarding",
  beforeLoad: keepToWindows,
  validateSearch: z.object({
    step: onboardingStepSchema
      .default(OnboardingStep.Welcome)
      .catch(OnboardingStep.Welcome),
  }),
  component: OnboardingPage,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // An unknown tab falls back to the first, and an unknown market to every market, rather than failing the page.
  validateSearch: z.object({
    tab: overviewTabSchema.default(OverviewTab.Today).catch(OverviewTab.Today),
    market: marketSchema.optional().catch(undefined),
  }),
  component: OverviewPage,
});

// A missing or unknown interval falls back to daily bars, a view to the news and a chart to bars, instead of failing the page.
const symbolSearchSchema = z.object({
  interval: intervalSchema.default(Interval.OneDay).catch(Interval.OneDay),
  view: lowerViewSchema.default(LowerView.News).catch(LowerView.News),
  chart: chartKindSchema.default(ChartKind.Candles).catch(ChartKind.Candles),
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

// The strategies read only what the workspace keeps, so a paired browser opens them too.
const strategiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "strategies",
  component: StrategiesPage,
});

const strategyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "strategies/$name",
  // A name no strategy could take matches no route, so it lands on the not-found page.
  params: {
    parse: (params) =>
      z.object({ name: strategyNameSchema }).safeParse(params).data ?? false,
  },
  component: StrategyPage,
});

// An unknown section falls back to the first rather than failing the page.
const settingsSearchSchema = z.object({
  section: settingsSectionSchema
    .default(SettingsSection.General)
    .catch(SettingsSection.General),
  /** The MCP server opened from the MCP section's list. */
  server: z.string().min(1).optional().catch(undefined),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  validateSearch: settingsSearchSchema,
  beforeLoad: keepToWindows,
  component: SettingsPage,
});

/** Builds load from file://, so routes live in the hash to survive reloads and open in new windows. */
/** A path's first segment names its kind of page: the overview, a listing, the strategies, settings or onboarding. */
const pageOf = (pathname: string) => pathname.split("/")[1];

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    overviewRoute,
    symbolRoute,
    strategiesRoute,
    strategyRoute,
    settingsRoute,
    onboardingRoute,
  ]),
  history: createHashHistory(),
  defaultErrorComponent: ErrorFallback,
  defaultNotFoundComponent: NotFound,
  // The main view scrolls rather than the window, so a new page or settings section opens at its top.
  scrollToTopSelectors: ["main"],
  // Moving to another kind of page crossfades the main view. Flipping between listings, the most
  // frequent move and often by keyboard, and a new interval, overview tab or settings section
  // update in place.
  defaultViewTransition: {
    types: ({ fromLocation, toLocation }) =>
      fromLocation &&
      pageOf(fromLocation.pathname) === pageOf(toLocation.pathname)
        ? false
        : ["page"],
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
