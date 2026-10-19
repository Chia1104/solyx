import { useEffect, useRef } from "react";

import { Chip, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Depth, DepthLevel } from "@solyx/core/market-data";
import { twLots } from "@solyx/core/rules/tw";

import { highlight } from "../../components/highlight.ts";
import { LoadingState } from "../../components/loading-state.tsx";

import { bandQuery } from "./band-query.ts";
import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import { directionOf } from "./quote-figures.tsx";
import { useDepth } from "./use-depth.ts";

const BOOK_LEVELS = 5;

/** The listing's session so far and its best bids and asks, as its source pushes them. */
export function DepthPanel({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();
  const depth = useDepth(symbol);

  if (depth === undefined) return <LoadingState />;

  if (depth === null) {
    return <p className="p-2 text-sm text-muted">{t("depth.none")}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <QuoteBoard symbol={symbol} depth={depth} />
      <DepthLadder symbol={symbol} depth={depth} />
    </div>
  );
}

/** Taiwan's book counts board lots, as its traders read it; elsewhere it counts shares. */
const sizeOf = (market: Market, shares: number) =>
  market === Market.TW ? twLots(shares) : shares;

function QuoteBoard({ symbol, depth }: { symbol: SymbolRef; depth: Depth }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(symbol.market);
  const { data: band } = useQuery(bandQuery(symbol));
  const lastElement = useRef<HTMLSpanElement>(null);
  const seen = useRef<number | null>(null);

  const { last, reference } = depth;

  useEffect(() => {
    const before = seen.current;

    seen.current = last;

    if (last === null || before === null || last === before) return;

    highlight(
      lastElement.current,
      (last > before ? direction.rise : direction.fall).solid
    );
  }, [last, direction]);

  const change = last === null ? null : last - reference;
  const moved = change === null ? undefined : directionOf(direction, change);
  const matched = depth.volumeAtAsk + depth.volumeAtBid;

  const price = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "–"
      : format.quotePrice.format(value);

  const priced = (value: number | null) =>
    value === null
      ? undefined
      : directionOf(direction, value - reference)?.text;

  return (
    <section aria-label={t("depth.title")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          ref={lastElement}
          className={cn(
            "-mx-1 rounded-sm px-1 text-2xl font-semibold tabular-nums",
            moved?.text
          )}>
          {price(last)}
        </span>
        {change === null ? null : (
          <span
            className={cn(
              "text-sm font-medium tabular-nums",
              moved?.text ?? "text-muted"
            )}>
            {format.quoteChange.format(change)}{" "}
            {format.quotePercentChange.format(change / reference)}
          </span>
        )}
        {depth.trial ? (
          <Chip size="sm" variant="soft">
            {t("depth.trial")}
          </Chip>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
        <Figure label={t("depth.open")} className={priced(depth.open)}>
          {price(depth.open)}
        </Figure>
        <Figure label={t("depth.high")} className={priced(depth.high)}>
          {price(depth.high)}
        </Figure>
        <Figure label={t("depth.low")} className={priced(depth.low)}>
          {price(depth.low)}
        </Figure>
        <Figure label={t("depth.average")} className={priced(depth.average)}>
          {price(depth.average)}
        </Figure>
        <Figure label={t("depth.reference")}>{price(reference)}</Figure>
        <Figure label={t(`depth.volume.${symbol.market}`)}>
          {format.amount.format(sizeOf(symbol.market, depth.volume))}
        </Figure>
        <Figure label={t("depth.limit-up")} className={direction.rise.text}>
          {price(band?.high)}
        </Figure>
        <Figure label={t("depth.limit-down")} className={direction.fall.text}>
          {price(band?.low)}
        </Figure>
      </dl>
      {matched > 0 ? (
        <div className="flex flex-col gap-1 text-xs text-muted">
          <div
            aria-hidden
            className="flex h-1.5 overflow-hidden rounded-full bg-muted/40">
            <div
              className="bg-foreground/70"
              style={{ width: `${(depth.volumeAtAsk / matched) * 100}%` }}
            />
          </div>
          <div className="flex justify-between tabular-nums">
            <span>
              {t("depth.at-ask", {
                share: format.percent.format(depth.volumeAtAsk / matched),
              })}
            </span>
            <span>
              {t("depth.at-bid", {
                share: format.percent.format(depth.volumeAtBid / matched),
              })}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Figure({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("font-medium tabular-nums", className)}>{children}</dd>
    </div>
  );
}

/** The best five asks above the best five bids, each side's sizes drawn against the largest. */
function DepthLadder({ symbol, depth }: { symbol: SymbolRef; depth: Depth }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(symbol.market);

  const asks = padded(depth.asks).toReversed();
  const bids = padded(depth.bids);

  const largest = Math.max(
    1,
    ...[...depth.asks, ...depth.bids].map(({ shares }) => shares)
  );

  const total = (levels: DepthLevel[]) =>
    format.amount.format(
      sizeOf(
        symbol.market,
        levels.reduce((sum, { shares }) => sum + shares, 0)
      )
    );

  const row = (
    level: DepthLevel | undefined,
    side: "ask" | "bid",
    index: number
  ) => {
    const size = level
      ? format.amount.format(sizeOf(symbol.market, level.shares))
      : "";

    const bar = level ? (
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0.5 bg-foreground/10",
          side === "bid" ? "right-0" : "left-0"
        )}
        style={{ width: `${(level.shares / largest) * 100}%` }}
      />
    ) : null;

    return (
      <tr key={`${side}-${index}`} className="h-6">
        <td className="relative w-2/5 pr-2 text-right">
          {side === "bid" ? bar : null}
          <span className="relative">{side === "bid" ? size : ""}</span>
        </td>
        <td
          className={cn(
            "text-center font-medium",
            level && directionOf(direction, level.price - depth.reference)?.text
          )}>
          {level ? format.quotePrice.format(level.price) : ""}
        </td>
        <td className="relative w-2/5 pl-2 text-left">
          {side === "ask" ? bar : null}
          <span className="relative">{side === "ask" ? size : ""}</span>
        </td>
      </tr>
    );
  };

  return (
    <section aria-label={t("depth.book")} className="flex flex-col gap-1.5">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-muted">
          <tr>
            <th className="pr-2 text-right font-normal">{t("depth.bids")}</th>
            <th className="text-center font-normal">{t("depth.price")}</th>
            <th className="pl-2 text-left font-normal">{t("depth.asks")}</th>
          </tr>
        </thead>
        <tbody>
          {asks.map((level, index) => row(level, "ask", index))}
          {bids.map((level, index) => row(level, "bid", index))}
        </tbody>
      </table>
      <p className="flex justify-between text-xs text-muted tabular-nums">
        <span>{t("depth.bids-total", { total: total(depth.bids) })}</span>
        <span>{t(`depth.unit.${symbol.market}`)}</span>
        <span>{t("depth.asks-total", { total: total(depth.asks) })}</span>
      </p>
    </section>
  );
}

/** Every side as five rows, so the ladder keeps its height as levels come and go. */
function padded(levels: DepthLevel[]): (DepthLevel | undefined)[] {
  return Array.from({ length: BOOK_LEVELS }, (_, index) => levels[index]);
}
