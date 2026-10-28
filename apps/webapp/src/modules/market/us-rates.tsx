import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market, US_VOLATILITY_INDEX } from "@solyx/core/market";
import { TreasuryTenor, curveSpread } from "@solyx/core/yields";
import type { YieldCurve } from "@solyx/core/yields";

import { Sparkline } from "../../components/sparkline.tsx";
import { FigureRow } from "../../components/symbol-row.tsx";
import { yieldsQuery } from "../macro/macro-query.ts";

import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import {
  QuoteChange,
  QuoteLine,
  QuotePrice,
  directionOf,
} from "./quote-figures.tsx";

/** Basis points in a percentage point. */
const BASIS_POINTS = 100;

/** A figure of each day's curve: a tenor's yield, or ten years' over two years'. */
type CurveFigure = (curve: YieldCurve) => number | null;

const tenor =
  (of: TreasuryTenor): CurveFigure =>
  ({ yields }) =>
    yields[of];

/** A figure's value at each day it has one, by the day's place among the curves, and its move over the last day in basis points. */
function curvePath(curves: readonly YieldCurve[], read: CurveFigure) {
  const points = curves.flatMap((curve, index) => {
    const value = read(curve);

    return value === null ? [] : [{ time: index, value }];
  });

  const last = points.at(-1);
  const before = points.at(-2);

  return {
    points,
    last,
    moved: last && before ? (last.value - before.value) * BASIS_POINTS : null,
  };
}

/** One figure of the yield curve: its newest close, its move from the day before in basis points, and its path over the days read. */
function CurveRow({
  code,
  name,
  curves,
  read,
  spread = false,
}: {
  code: string;
  name: string;
  curves: readonly YieldCurve[];
  read: CurveFigure;
  /** Whether the figure is a gap between two yields, shown in basis points rather than percent. */
  spread?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(Market.US);
  const { points, last, moved } = curvePath(curves, read);
  const tone = moved === null ? undefined : directionOf(direction, moved);

  const basisPoints = (value: number) =>
    t("heat-map.rates.basis-points", {
      value: format.signedIndicator.format(Math.round(value)),
    });

  return (
    <FigureRow
      code={code}
      name={<span className="truncate text-xs text-muted">{name}</span>}
      price={
        last === undefined
          ? "–"
          : spread
            ? basisPoints(last.value * BASIS_POINTS)
            : format.rate.format(last.value / 100)
      }
      chart={
        last && points.length > 1 ? (
          <Sparkline
            points={points}
            from={points[0]?.time ?? last.time}
            to={last.time}
            baseline={spread ? 0 : null}
            color={tone?.solid ?? "var(--muted)"}
            className="size-full"
          />
        ) : null
      }
      detail={
        moved === null ? null : (
          <span className={tone?.text ?? "text-muted"}>
            {basisPoints(moved)}
          </span>
        )
      }
    />
  );
}

/** The VIX beside the Treasury yields that price the US's money, each with its move and recent path. */
export function UsRates() {
  const { t } = useTranslation();
  const { data = [], isError } = useQuery(yieldsQuery());
  const unread = isError ? t("heat-map.rates.unread") : null;

  return (
    <ul className="grid grid-cols-2 gap-2 @min-[44rem]/main:grid-cols-4">
      <li className="min-w-0 well">
        <FigureRow
          code="VIX"
          name={
            <span className="truncate text-xs text-muted">
              {t("heat-map.rates.vix")}
            </span>
          }
          price={<QuotePrice symbol={US_VOLATILITY_INDEX} />}
          chart={
            <QuoteLine symbol={US_VOLATILITY_INDEX} className="size-full" />
          }
          detail={<QuoteChange symbol={US_VOLATILITY_INDEX} />}
        />
      </li>
      <li className="min-w-0 well" title={unread ?? undefined}>
        <CurveRow
          code="2Y"
          name={t("heat-map.rates.two-year")}
          curves={data}
          read={tenor(TreasuryTenor.TwoYears)}
        />
      </li>
      <li className="min-w-0 well" title={unread ?? undefined}>
        <CurveRow
          code="10Y"
          name={t("heat-map.rates.ten-year")}
          curves={data}
          read={tenor(TreasuryTenor.TenYears)}
        />
      </li>
      <li className="min-w-0 well" title={unread ?? undefined}>
        <CurveRow
          code="10Y−2Y"
          name={t("heat-map.rates.spread")}
          curves={data}
          read={curveSpread}
          spread
        />
      </li>
    </ul>
  );
}
