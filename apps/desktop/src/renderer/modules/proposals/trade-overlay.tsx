import { useEffect, useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { LineSeries, LineStyle } from "lightweight-charts";
import type {
  CreatePriceLineOptions,
  ISeriesApi,
  LineSeriesPartialOptions,
  MouseEventParams,
  SeriesMarker,
  Time,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import type { Candle } from "@solyx/core/candles";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { Fill } from "@solyx/core/order";
import { ProposalStatus, exitWatched } from "@solyx/core/order-desk";
import { nearestTick } from "@solyx/core/risk";
import { isChartRemoved, useChart } from "@solyx/trading-chart/chart";
import { Series } from "@solyx/trading-chart/series";
import { utcTimestamp } from "@solyx/trading-chart/time-format";

import { orpc } from "../../app/rpc.ts";
import { usePaletteColors } from "../../app/theme.ts";
import { bandQuery } from "../market/band-query.ts";
import { faded } from "../market/chart-palette.ts";
import { useDirectionColors } from "../market/price-colors.ts";

import { proposalsQuery } from "./proposals-query.ts";
import { showTicket } from "./show-ticket.ts";
import { useTicketStore } from "./ticket-store.ts";

// The series only carries the lines and marks: it follows the closes, so it never moves the scale.
const CARRIER_OPTIONS: LineSeriesPartialOptions = {
  color: "transparent",
  lineVisible: false,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
};

/** The bar each fill traded in: the last that opened at or before it. */
function fillBars(fills: Fill[], candles: Candle[]) {
  const bars = new Map<number, Fill[]>();

  for (const fill of fills) {
    const at = fill.filledAt / 1000;
    let index = candles.length - 1;

    while (index >= 0 && candles[index].time > at) index -= 1;

    if (index < 0) continue;

    const time = candles[index].time;

    bars.set(time, [...(bars.get(time) ?? []), fill]);
  }

  return bars;
}

/**
 * What the account does in the listing, over its bars: the position's average cost, working
 * orders and watched exits in ink, proposals still waiting in pencil, the session's limits and a
 * mark where each fill traded. While the order panel asks for one, a click picks a price.
 */
export function TradeOverlay({
  symbol,
  candles,
}: {
  symbol: SymbolRef;
  candles: Candle[];
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const direction = useDirectionColors(symbol.market);
  const [carrier, setCarrier] = useState<ISeriesApi<"Line"> | null>(null);
  const key = symbolKey(symbol);

  const isListing = ({ market, symbol: code }: SymbolRef) =>
    symbolKey({ market, symbol: code }) === key;

  const position = useQuery({
    ...orpc.account.summary.queryOptions(),
    select: (account) =>
      account.positions.find(({ instrument }) => isListing(instrument)),
  }).data;

  const working = useQuery({
    ...orpc.account.working.queryOptions(),
    select: (orders) =>
      orders.filter(({ order }) => isListing(order.instrument)),
  }).data;

  const proposals = useQuery({
    ...proposalsQuery(),
    select: (list) => list.filter(({ order }) => isListing(order.instrument)),
  }).data;

  const fills = useQuery(
    orpc.account.fills.queryOptions({ input: symbol })
  ).data;

  const { data: band } = useQuery(bandQuery(symbol));

  const data = useMemo(
    () =>
      candles.map((candle) => ({
        time: utcTimestamp(candle.time),
        value: candle.close,
      })),
    [candles]
  );

  const priceLines = useMemo(() => {
    const lines: CreatePriceLineOptions[] = [];
    const amount = new Intl.NumberFormat(i18n.language);

    const line = (
      price: number,
      title: string,
      color: string,
      lineStyle: LineStyle
    ) =>
      lines.push({
        price,
        title,
        color,
        lineStyle,
        lineWidth: 1,
        axisLabelVisible: true,
      });

    if (position) {
      line(
        position.avgPrice,
        t("chart.trades.average"),
        colors.foreground,
        LineStyle.Solid
      );
    }

    for (const { order } of working ?? []) {
      if (order.type !== OrderType.Limit) continue;

      line(
        order.limitPrice,
        `${t(`side.${order.side}`)} ${amount.format(order.quantity)}`,
        colors.accent,
        LineStyle.Solid
      );
    }

    for (const proposal of proposals ?? []) {
      const { order, exit } = proposal;
      const waiting = proposal.status === ProposalStatus.AwaitingConfirmation;

      if (exit && (waiting || exitWatched(proposal))) {
        const color = waiting ? colors.muted : colors.accent;
        const lineStyle = waiting ? LineStyle.Dashed : LineStyle.Dotted;

        if (exit.stop !== null) {
          line(exit.stop, t("chart.trades.stop"), color, lineStyle);
        }

        if (exit.target !== null) {
          line(exit.target, t("chart.trades.target"), color, lineStyle);
        }
      } else if (waiting && order.type === OrderType.Limit) {
        line(
          order.limitPrice,
          t("chart.trades.proposed", {
            side: t(`side.${order.side}`),
            quantity: amount.format(order.quantity),
          }),
          colors.muted,
          LineStyle.Dashed
        );
      }
    }

    if (band) {
      line(
        band.high,
        t("chart.trades.limit-up"),
        direction.rise.faded,
        LineStyle.SparseDotted
      );
      line(
        band.low,
        t("chart.trades.limit-down"),
        direction.fall.faded,
        LineStyle.SparseDotted
      );
    }

    return lines;
  }, [position, working, proposals, band, colors, direction, t, i18n.language]);

  const markers = useMemo(() => {
    if (!fills) return undefined;

    const amount = new Intl.NumberFormat(i18n.language);

    return [...fillBars(fills, candles)].flatMap(([time, traded]) =>
      Object.values(Side).flatMap((side) => {
        const shares = traded
          .filter((fill) => fill.side === side)
          .reduce((sum, fill) => sum + fill.quantity, 0);

        if (shares === 0) return [];

        return [
          {
            time: utcTimestamp(time),
            position: side === Side.Buy ? "belowBar" : "aboveBar",
            // Lightweight Charts' own field; a computed key keeps it apart from the names we choose.
            ["shape"]: side === Side.Buy ? "arrowUp" : "arrowDown",
            color: faded(colors.accent, 0.9),
            text: `${t(`side.${side}`)} ${amount.format(shares)}`,
          },
        ] satisfies SeriesMarker<Time>[];
      })
    );
  }, [fills, candles, colors, t, i18n.language]);

  return (
    <>
      <Series
        ref={setCarrier}
        definition={LineSeries}
        data={data}
        options={CARRIER_OPTIONS}
        priceLines={priceLines}
        markers={markers}
      />
      {carrier ? <PriceClick symbol={symbol} series={carrier} /> : null}
    </>
  );
}

/** While the order panel asks for a price, the next click on the price pane picks its nearest tick. */
function PriceClick({
  symbol,
  series,
}: {
  symbol: SymbolRef;
  series: ISeriesApi<"Line">;
}) {
  const chart = useChart();
  const picking = useTicketStore((state) => state.pickingOnChart);
  const pick = useTicketStore((state) => state.pick);
  const setPicking = useTicketStore((state) => state.setPickingOnChart);

  useEffect(() => {
    if (!picking) return;

    const click = ({ point, paneIndex }: MouseEventParams) => {
      if (!point || paneIndex !== 0) return;

      const price = series.coordinateToPrice(point.y);

      if (price === null || price <= 0) return;

      pick(symbol, nearestTick(symbol, price));
      setPicking(false);
      showTicket();
    };

    chart.subscribeClick(click);

    return () => {
      if (!isChartRemoved(chart)) chart.unsubscribeClick(click);
    };
  }, [chart, series, picking, pick, setPicking, symbol]);

  return null;
}
