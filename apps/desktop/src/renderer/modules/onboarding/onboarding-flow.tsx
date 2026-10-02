import type { ReactNode } from "react";

import { Button, cn } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { RailedColumn } from "../../components/sheet.tsx";
import { WindowTitleBar } from "../../components/window-title-bar.tsx";
import { BrokerModeRule } from "../account/broker-mode-chip.tsx";

import { ONBOARDING_STEPS, OnboardingStep } from "./onboarding-step.ts";
import { useOnboardingStore } from "./onboarding-store.ts";

/** Steps behind are inked, the current one outlined in ink, and those ahead drawn in pencil. */
function OnboardingProgress({ current }: { current: OnboardingStep }) {
  const { t } = useTranslation();
  const currentIndex = ONBOARDING_STEPS.indexOf(current);

  return (
    <ol className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {ONBOARDING_STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === currentIndex ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 text-sm",
            index > currentIndex ? "text-muted" : "text-foreground"
          )}>
          <span
            aria-hidden
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
              index < currentIndex && "bg-accent text-accent-foreground",
              index === currentIndex && "border border-accent text-accent",
              index > currentIndex && "border border-dashed border-border"
            )}>
            {index + 1}
          </span>
          {t(`onboarding.steps.${step}`)}
        </li>
      ))}
    </ol>
  );
}

/**
 * First-run setup in a window of its own: progress above the step, and the way forward below
 * it. A step that is not `complete` can be put off, except the first, which only has preferences.
 */
export function OnboardingFlow({
  step,
  complete,
  children,
}: {
  step: OnboardingStep;
  complete: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const finish = useOnboardingStore((state) => state.finish);

  const index = ONBOARDING_STEPS.indexOf(step);
  const previous = index > 0 ? ONBOARDING_STEPS.at(index - 1) : undefined;
  const next = ONBOARDING_STEPS.at(index + 1);

  const go = (target: OnboardingStep) =>
    void navigate({ to: "/onboarding", search: { step: target } });

  const leave = () => {
    finish();
    void navigate({ to: "/" });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden text-sm">
      <WindowTitleBar className="px-4">
        <span className="text-sm font-semibold">Solyx</span>
        <span className="text-sm text-muted">{t("onboarding.title")}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onPress={leave}>
          {t("onboarding.skip")}
        </Button>
      </WindowTitleBar>
      <BrokerModeRule />
      <div className="@container/main min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          <div className="border-b border-separator">
            <RailedColumn className="px-6 py-3">
              <OnboardingProgress current={step} />
            </RailedColumn>
          </div>
          {children}
          <div className="border-b border-separator">
            <RailedColumn className="flex items-center gap-2 px-6 py-4">
              {previous ? (
                <Button variant="tertiary" onPress={() => go(previous)}>
                  {t("onboarding.back")}
                </Button>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {next && !complete ? (
                  <Button variant="ghost" onPress={() => go(next)}>
                    {t("onboarding.later")}
                  </Button>
                ) : null}
                {next ? (
                  <Button
                    variant="secondary"
                    isDisabled={!complete}
                    onPress={() => go(next)}>
                    {step === OnboardingStep.Welcome
                      ? t("onboarding.start")
                      : t("onboarding.next")}
                  </Button>
                ) : (
                  <Button variant="secondary" onPress={leave}>
                    {t("onboarding.finish")}
                  </Button>
                )}
              </div>
            </RailedColumn>
          </div>
          <RailedColumn className="flex-1" />
        </div>
      </div>
    </div>
  );
}
