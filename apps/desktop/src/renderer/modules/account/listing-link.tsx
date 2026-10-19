import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

import { ListingName } from "../market/listing-name.tsx";

/** A listing's code, name and market, opening its page. */
export function ListingLink({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();

  return (
    <Link
      to="/symbol/$market/$symbol"
      params={{ market: symbol.market, symbol: symbol.symbol }}
      className="flex min-w-0 items-baseline gap-1.5 hover:underline">
      <span className="shrink-0 font-medium">{symbol.symbol}</span>
      <ListingName symbol={symbol} />
      <span className="shrink-0 text-xs text-muted">
        {t(`market.${symbol.market}`)}
      </span>
    </Link>
  );
}
