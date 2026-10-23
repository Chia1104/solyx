import { buttonVariants } from "@heroui/styles";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { OnboardingStep } from "./onboarding-step.ts";

/** Opens first-run setup again from the start. */
export function SetupGuideLink() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">
        {t("onboarding.restart.label")}
      </span>
      <p className="text-xs text-muted">
        {t("onboarding.restart.description")}
      </p>
      <div>
        <Link
          to="/onboarding"
          search={{ step: OnboardingStep.Welcome }}
          className={buttonVariants({ size: "sm", variant: "secondary" })}>
          {t("onboarding.restart.action")}
        </Link>
      </div>
    </div>
  );
}
