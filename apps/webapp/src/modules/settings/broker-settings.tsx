import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { SectionLoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";

import { FubonSettings } from "./fubon-settings.tsx";
import { marketDataQuery } from "./settings-query.ts";

/** Each broker's sign-in, whichever source Taiwan's charts come from and whichever account orders go to. */
export function BrokerSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(marketDataQuery());

  if (error) {
    return <SectionLoadError error={error} onRetry={() => void refetch()} />;
  }

  if (!data) return <LoadingState />;

  return (
    <Section
      title={t("settings.brokers.fubon")}
      description={t("settings.brokers.fubon-description")}>
      <FubonSettings status={data} />
    </Section>
  );
}
