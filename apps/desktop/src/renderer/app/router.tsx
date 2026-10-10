import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import * as z from "zod";

import { Interval, intervalSchema } from "@solyx/core/candles";
import { symbolRefSchema } from "@solyx/core/market";

import { isMarketDataReady } from "#shared/ipc/settings.ts";
import {
  SettingsSection,
  settingsSectionSchema,
} from "#shared/settings-section.ts";

import { ErrorFallback } from "../components/error-fallback.tsx";
import { NotFound } from "../components/not-found.tsx";
import {
  OnboardingStep,
  onboardingStepSchema,
} from "../modules/onboarding/onboarding-step.ts";
import { useOnboardingStore } from "../modules/onboarding/onboarding-store.ts";
import { marketDataQuery } from "../modules/settings/settings-query.ts";
import { OnboardingPage } from "../pages/onboarding-page.tsx";
import { OverviewPage } from "../pages/overview-page.tsx";
import { OverviewTab, overviewTabSchema } from "../pages/overview-tab.ts";
import { SettingsPage } from "../pages/settings-page.tsx";
import { SymbolPage } from "../pages/symbol-page.tsx";

import { queryClient } from "./query-client.ts";
import { RootLayout } from "./root-layout.tsx";

const rootRoute = createRootRoute({
  component: RootLayout,
  // First-run setup comes before the workspace until it is finished or skipped. Someone whose
  // market data already works, as after editing the config file by hand, never sees it.
  beforeLoad: async ({ location }) => {
    const onboarding = useOnboardingStore.getState();

    if (onboarding.finished || location.pathname === "/onboarding") return;

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

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "onboarding",
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
  // An unknown tab falls back to the first rather than failing the page.
  validateSearch: z.object({
    tab: overviewTabSchema.default(OverviewTab.Today).catch(OverviewTab.Today),
  }),
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
  component: SettingsPage,
});

/** Builds load from file://, so routes live in the hash to survive reloads and open in new windows. */
/** A path's first segment names its kind of page: the overview, a listing, settings or onboarding. */
const pageOf = (pathname: string) => pathname.split("/")[1];

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    overviewRoute,
    symbolRoute,
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
