import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

/** A listing in a side list that opens its chart; the open one is marked with an ink rule. */
export function SymbolRow({
  symbol,
  children,
}: {
  symbol: SymbolRef;
  /** A figure shown at the row's end, such as shares held. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Link
      to="/symbol/$market/$symbol"
      params={symbol}
      // Keeps the interval when moving between charts.
      search={true}
      activeOptions={{ includeSearch: false }}
      className="flex h-8 items-center gap-2 px-4 text-sm outline-none hover:bg-default/60 focus-visible:bg-default data-[status=active]:bg-default data-[status=active]:shadow-[inset_2px_0_0_var(--accent)]">
      <span className="font-medium">{symbol.symbol}</span>
      <span className="text-xs text-muted">{t(`market.${symbol.market}`)}</span>
      {children ? (
        <span className="ml-auto text-xs text-muted tabular-nums">
          {children}
        </span>
      ) : null}
    </Link>
  );
}
