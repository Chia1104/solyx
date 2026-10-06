import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

/**
 * A listing in a side list that opens its chart; the open one is marked with an ink rule. The
 * code, name and price share the first line, and a chart runs the width of the second beside
 * its detail. The market gives way first when the symbols pane is narrow, then the name.
 */
export function SymbolRow({
  symbol,
  name,
  price,
  chart,
  detail,
}: {
  symbol: SymbolRef;
  /** Shown after the code; it should truncate, so it gives way when the row is narrow. */
  name?: ReactNode;
  price?: ReactNode;
  /** A small chart that fills the second line, such as the session's line. */
  chart?: ReactNode;
  /** A figure at the second line's end, such as the change since the last close. */
  detail?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Link
      to="/symbol/$market/$symbol"
      params={symbol}
      // Keeps the interval when moving between charts.
      search={true}
      activeOptions={{ includeSearch: false }}
      // A row in a list the user reorders drags as a whole rather than as a link.
      draggable={false}
      className="flex flex-col gap-1 px-4 py-2 outline-none hover:bg-default/60 focus-visible:bg-default data-[status=active]:bg-default data-[status=active]:shadow-[inset_2px_0_0_var(--accent)]">
      <span className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className="shrink-0 font-medium">{symbol.symbol}</span>
        {name}
        <span className="hidden shrink-0 text-xs text-muted @min-[14rem]/symbols:inline">
          {t(`market.${symbol.market}`)}
        </span>
        {price ? (
          <span className="ml-auto shrink-0 pl-1 tabular-nums">{price}</span>
        ) : null}
      </span>
      {chart || detail ? (
        <span className="flex items-center gap-3">
          <span className="h-7 min-w-0 flex-1">{chart}</span>
          <span className="shrink-0 text-xs tabular-nums">{detail}</span>
        </span>
      ) : null}
    </Link>
  );
}
