import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { SymbolRow } from "../../components/symbol-row.tsx";

import { ListingName } from "./listing-name.tsx";
import { QuoteChange, QuoteLine, QuotePrice } from "./quote-figures.tsx";

/** Funds that track a market's broad indices, each with its session's line, last price and change, opening its chart. */
export function IndexFunds({ symbols }: { symbols: readonly SymbolRef[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 @min-[44rem]/main:grid-cols-4">
      {symbols.map((symbol) => (
        <li key={symbolKey(symbol)} className="min-w-0 well">
          <SymbolRow
            symbol={symbol}
            name={<ListingName symbol={symbol} />}
            price={<QuotePrice symbol={symbol} />}
            chart={<QuoteLine symbol={symbol} className="size-full" />}
            detail={<QuoteChange symbol={symbol} />}
          />
        </li>
      ))}
    </ul>
  );
}
