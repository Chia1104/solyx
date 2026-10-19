import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { PositionsTable } from "./positions-table.tsx";
import { WorkingOrders } from "./working-orders.tsx";

export function AccountSummary() {
  const { t, i18n } = useTranslation();

  const { data, error, refetch } = useQuery(
    orpc.account.summary.queryOptions()
  );

  const format = numberFormats(i18n.language);

  return (
    <Section title={t("account.title")}>
      {error ? (
        <LoadError error={error} onRetry={() => void refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-6">
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            {Object.entries(data.cash).map(([currency, amount]) => (
              <div key={currency} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted">
                  {t("account.cash")} {currency}
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {amount === null
                    ? t("account.cash-unknown")
                    : format.price.format(amount ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
          <PositionsTable positions={data.positions} />
          <WorkingOrders />
        </div>
      ) : (
        <LoadingState />
      )}
    </Section>
  );
}
