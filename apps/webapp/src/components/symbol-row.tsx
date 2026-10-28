import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";

import type { SymbolRef } from "@solyx/core/market";

interface RowFigures {
  /** Shown after the code; it should truncate, so it gives way when the row is narrow. */
  name?: ReactNode;
  price?: ReactNode;
  /** A small chart that fills the second line, such as the session's line. */
  chart?: ReactNode;
  /** A figure at the second line's end, such as the change since the last close. */
  detail?: ReactNode;
}

const ROW_CLASS = "flex flex-col gap-1 rounded-sheet px-4 py-2";

/** A row's lines: the code, name and price on the first, and a chart running the width of the second beside its detail. */
function RowLines({
  code,
  name,
  price,
  chart,
  detail,
}: RowFigures & { code: ReactNode }) {
  return (
    <>
      <span className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className="shrink-0 font-medium">{code}</span>
        {name}
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
    </>
  );
}

/**
 * A listing in a side list that opens its chart; the open one lies on a sheet of its own. The
 * name gives way when the symbols pane is narrow.
 */
export function SymbolRow({
  symbol,
  ...figures
}: RowFigures & { symbol: SymbolRef }) {
  return (
    <Link
      to="/symbol/$market/$symbol"
      params={symbol}
      // Keeps the interval when moving between charts.
      search={true}
      activeOptions={{ includeSearch: false }}
      // A row in a list the user reorders drags as a whole rather than as a link.
      draggable={false}
      className={`${ROW_CLASS} outline-none hover:bg-default/60 focus-visible:bg-default data-[status=active]:sheet`}>
      <RowLines code={symbol.symbol} {...figures} />
    </Link>
  );
}

/** A figure laid out as a listing's row is, such as a yield, which opens no chart. */
export function FigureRow({
  code,
  ...figures
}: RowFigures & { code: ReactNode }) {
  return (
    <div className={ROW_CLASS}>
      <RowLines code={code} {...figures} />
    </div>
  );
}
