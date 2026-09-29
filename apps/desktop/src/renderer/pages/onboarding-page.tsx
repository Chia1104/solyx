import type { ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";

import { Section } from "../components/section.tsx";
import { OnboardingFlow } from "../modules/onboarding/onboarding-flow.tsx";
import { OnboardingStep } from "../modules/onboarding/onboarding-step.ts";
import { SetupSummary } from "../modules/onboarding/setup-summary.tsx";
import { LanguageSelect } from "../modules/settings/language-select.tsx";
import { MarketDataSettings } from "../modules/settings/market-data-settings.tsx";
import { marketDataQuery } from "../modules/settings/settings-query.ts";
import { ThemeSelect } from "../modules/settings/theme-select.tsx";

const route = getRouteApi("/onboarding");

export function OnboardingPage() {
  const { t } = useTranslation();
  const { step } = route.useSearch();
  const marketData = useQuery(marketDataQuery());

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
            <LanguageSelect />
          </div>
        </Section>
      ),
    },
    [OnboardingStep.MarketData]: {
      complete: marketData.data?.markets[Market.TW]?.ready === true,
      content: <MarketDataSettings />,
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
