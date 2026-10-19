import { useState } from "react";
import type { ReactNode } from "react";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { FillsTable } from "./fills-table.tsx";
import { PositionsTable } from "./positions-table.tsx";
import { WorkingOrders } from "./working-orders.tsx";

const AccountView = {
  Positions: "positions",
  Working: "working",
  Fills: "fills",
} as const;

type AccountView = (typeof AccountView)[keyof typeof AccountView];

function Positions() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data, error, refetch } = useQuery(
    orpc.account.summary.queryOptions()
  );

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap gap-x-6 text-sm tabular-nums">
        {Object.entries(data.cash).map(([currency, amount]) => (
          <span key={currency}>
            <span className="text-muted">
              {t("account.cash")} {currency}
            </span>{" "}
            {amount === null || amount === undefined
              ? t("account.cash-unknown")
              : format.price.format(amount)}
          </span>
        ))}
      </p>
      <PositionsTable positions={data.positions} />
    </div>
  );
}

/**
 * The account under a listing's chart: what it holds, its orders still working and its newest
 * fills, filling the height it is given.
 */
export function AccountPanel({
  heading,
}: {
  /** What leads the header row, such as the switch between this and the news. */
  heading: ReactNode;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<AccountView>(AccountView.Positions);

  return (
    <section
      aria-label={t("account.title")}
      className="flex h-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading}
        <ToggleButtonGroup
          aria-label={t("account.title")}
          selectionMode="single"
          disallowEmptySelection
          size="sm"
          className="ml-auto shrink-0"
          selectedKeys={[view]}
          onSelectionChange={(keys) => {
            const [next] = keys;

            if (isEnumValue(AccountView, next)) setView(next);
          }}>
          <ToggleButton id={AccountView.Positions}>
            {t("account.positions")}
          </ToggleButton>
          <ToggleButton id={AccountView.Working}>
            {t("account.working")}
          </ToggleButton>
          <ToggleButton id={AccountView.Fills}>
            {t("account.fills")}
          </ToggleButton>
        </ToggleButtonGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {view === AccountView.Positions ? <Positions /> : null}
        {view === AccountView.Working ? <WorkingOrders showEmpty /> : null}
        {view === AccountView.Fills ? <FillsTable /> : null}
      </div>
    </section>
  );
}
