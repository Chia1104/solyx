import { useTranslation } from "react-i18next";

import { Page } from "../components/page.tsx";
import { Section } from "../components/section.tsx";
import {
  StrategyList,
  StrategyProblems,
  StrategyRuntimes,
} from "../modules/strategies/strategy-list.tsx";

/**
 * The strategies the user wrote: each with whether it may run, how it did last and what to do with
 * it, the folders that do not read as one, and what a strategy's code runs on here.
 */
export function StrategiesPage() {
  const { t } = useTranslation();

  return (
    <Page title={t("nav.strategies")}>
      <Section
        title={t("strategies.page.list")}
        description={t("strategies.page.list-description")}>
        <StrategyList />
      </Section>
      <StrategyProblems />
      <Section
        title={t("strategies.page.runtimes")}
        description={t("strategies.page.runtimes-description")}>
        <StrategyRuntimes />
      </Section>
    </Page>
  );
}
