import type { ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import {
  isDecisionsReady,
  isMarketDataReady,
  isWebSearchReady,
} from "#shared/ipc/settings.ts";

import { Section } from "../components/section.tsx";
import { OnboardingFlow } from "../modules/onboarding/onboarding-flow.tsx";
import { OnboardingStep } from "../modules/onboarding/onboarding-step.ts";
import { SetupSummary } from "../modules/onboarding/setup-summary.tsx";
import { AgentSettings } from "../modules/settings/agent-settings.tsx";
import { DecisionsSettings } from "../modules/settings/decisions-settings.tsx";
import { LanguageSelect } from "../modules/settings/language-select.tsx";
import { MarketDataSettings } from "../modules/settings/market-data-settings.tsx";
import { NewsSettings } from "../modules/settings/news-settings.tsx";
import { PalettePicker } from "../modules/settings/palette-picker.tsx";
import { PriceColorsSelect } from "../modules/settings/price-colors-select.tsx";
import {
  agentSettingsQuery,
  decisionsSettingsQuery,
  marketDataQuery,
  secretsQuery,
  webSearchSettingsQuery,
} from "../modules/settings/settings-query.ts";
import { ThemeSelect } from "../modules/settings/theme-select.tsx";
import { WebSearchSettings } from "../modules/settings/web-search-settings.tsx";

const route = getRouteApi("/onboarding");

export function OnboardingPage() {
  const { t } = useTranslation();
  const { step } = route.useSearch();
  const marketData = useQuery(marketDataQuery());
  const agent = useQuery(agentSettingsQuery());
  const webSearch = useQuery(webSearchSettingsQuery());
  const decisions = useQuery(decisionsSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const steps: Record<
    OnboardingStep,
    { complete: boolean; content: ReactNode }
  > = {
    [OnboardingStep.Welcome]: {
      complete: true,
      content: (
        <Section
          title={t("onboarding.welcome.title")}
          description={t("onboarding.welcome.description")}>
          <div className="flex flex-col gap-6">
            <ThemeSelect />
            <PalettePicker editable={false} />
            <PriceColorsSelect />
            <LanguageSelect />
          </div>
        </Section>
      ),
    },
    [OnboardingStep.MarketData]: {
      complete: isMarketDataReady(marketData.data),
      content: <MarketDataSettings />,
    },
    [OnboardingStep.Agent]: {
      complete: agent.data?.ready === true,
      content: <AgentSettings />,
    },
    [OnboardingStep.WebSearch]: {
      complete: isWebSearchReady(webSearch.data),
      content: (
        <>
          <WebSearchSettings />
          <NewsSettings />
        </>
      ),
    },
    [OnboardingStep.Decisions]: {
      complete: isDecisionsReady(decisions.data, secrets.data),
      content: <DecisionsSettings />,
    },
    [OnboardingStep.Done]: {
      complete: true,
      content: (
        <Section
          title={t("onboarding.done.title")}
          description={t("onboarding.done.description")}>
          <SetupSummary />
        </Section>
      ),
    },
  };

  return (
    <OnboardingFlow step={step} complete={steps[step].complete}>
      {steps[step].content}
    </OnboardingFlow>
  );
}
