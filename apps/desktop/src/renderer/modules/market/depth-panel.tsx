import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Depth, DepthLevel } from "@solyx/core/market-data";
import type { PriceBand } from "@solyx/core/risk";
import { twLots } from "@solyx/core/rules/tw";
import { cssPercent } from "@solyx/utils/format";

import { LoadingState } from "../../components/loading-state.tsx";

import { bandQuery } from "./band-query.ts";
import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import type { DirectionColors } from "./price-colors.ts";
import { directionOf } from "./quote-figures.tsx";

const BOOK_LEVELS = 5;

/**
 * The listing's session so far and its best bids and asks, as `useDepth` follows them; a price
 * in the book is handed to `onPick`. The last price heads the page instead.
 */
export function DepthPanel({
  symbol,
  depth,
  onPick,
}: {
  symbol: SymbolRef;
  depth: Depth | null | undefined;
  onPick: (price: number) => void;
}) {
  const { t } = useTranslation();

  if (depth === undefined) return <LoadingState />;

  if (depth === null) {
    return <p className="p-2 text-sm text-muted">{t("depth.none")}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <QuoteBoard symbol={symbol} depth={depth} />
      <DepthLadder symbol={symbol} depth={depth} onPick={onPick} />
    </div>
  );
}

/** Taiwan's book counts board lots, as its traders read it; elsewhere it counts shares. */
const sizeOf = (market: Market, shares: number) =>
  market === Market.TW ? twLots(shares) : shares;

/**
 * Where the session has traded within what it may: the track runs from the limit-down to the
 * limit-up, or across the day's range and the reference where the market sets none; the
 * solid stretch is the day's low to high, ticks mark the reference and the open, and a mark the
 * last price in its direction's colour. The figures beside it say the same in numbers.
 */
function DayRange({
  depth,
  band,
  direction,
}: {
  depth: Depth;
  band: PriceBand | null | undefined;
  direction: DirectionColors;
}) {
  const { low, high, open, last, reference } = depth;

  if (low === null || high === null) return null;

  // Once the session is over the band is the next one's, which today's range may reach past.
  const from = Math.min(band?.low ?? low, low, reference);
  const to = Math.max(band?.high ?? high, high, reference);

  if (to <= from) return null;

  const at = (price: number) => cssPercent((price - from) / (to - from));

  return (
    <div aria-hidden className="relative h-4">
      <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted/20" />
      <span
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted/60"
        style={{ left: at(low), width: cssPercent((high - low) / (to - from)) }}
      />
      <span
        className="absolute inset-y-0 w-px bg-foreground/50"
        style={{ left: at(reference) }}
      />
      {open === null ? null : (
        <span
          className="absolute inset-y-0.5 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: at(open) }}
        />
      )}
      {last === null ? null : (
        <span
          className="absolute -top-1.5 size-0 -translate-x-1/2 border-x-4 border-t-[6px] border-x-transparent"
          style={{
            left: at(last),
            borderTopColor:
              directionOf(direction, last - reference)?.solid ??
              "var(--foreground)",
          }}
        />
      )}
    </div>
  );
}

/** The session's figures beside its last price, which the page's header shows. */
function QuoteBoard({ symbol, depth }: { symbol: SymbolRef; depth: Depth }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(symbol.market);
  const { data: band } = useQuery(bandQuery(symbol));
  const { reference } = depth;
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
      <DayRange depth={depth} band={band} direction={direction} />
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
function DepthLadder({
  symbol,
  depth,
  onPick,
}: {
  symbol: SymbolRef;
  depth: Depth;
  onPick: (price: number) => void;
}) {
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
          {level ? (
            <Button
              aria-label={t("depth.pick", {
                price: format.quotePrice.format(level.price),
              })}
              className="w-full rounded-sm outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
              onPress={() => onPick(level.price)}>
              {format.quotePrice.format(level.price)}
            </Button>
          ) : null}
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
