import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

import { FillsTable } from "./fills-table.tsx";
import { WorkingOrders } from "./working-orders.tsx";

/**
 * One listing's orders under its chart: those still working, then its newest fills, filling the
 * height it is given.
 */
export function ListingOrdersPanel({
  symbol,
  heading,
}: {
  symbol: SymbolRef;
  /** What leads the header row, such as the switch between this and the news. */
  heading: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("account.orders")}
      className="flex h-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        <section
          aria-label={t("account.working")}
          className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("account.working")}</h3>
          <WorkingOrders symbol={symbol} showEmpty />
        </section>
        <section
          aria-label={t("account.fills")}
          className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("account.fills")}</h3>
          <FillsTable symbol={symbol} />
        </section>
      </div>
    </section>
  );
}
