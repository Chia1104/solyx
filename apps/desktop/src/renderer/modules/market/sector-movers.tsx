import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Currency, Market } from "@solyx/core/market";
import { TW_SECTOR_INDICES, TwSector } from "@solyx/core/sectors";
import type { SectorMovers as Movers } from "@solyx/core/sectors";
import { cssPercent } from "@solyx/utils/format";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { sectorMoversQuery } from "../fundamentals/fundamentals-query.ts";

import { ListingName } from "./listing-name.tsx";
import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import { directionOf } from "./quote-figures.tsx";

/**
 * The companies that moved one sector's market value most, the rest in one row. Each row's ground
 * is a bar of its part of the move against the largest part shown, washing into its direction's
 * colour toward the end that marks it.
 */
function MoversTable({ movers }: { movers: Movers }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(Market.TW);

  // A company's part of the sector's move, in points of its market value, which add up to the move.
  const contribution = (value: number) =>
    format.quotePercentChange.format(value / movers.marketValue);

  const rows = [
    ...movers.movers.map((mover) => ({
      id: mover.symbol,
      mover,
      rest: null,
      valueChange: mover.valueChange,
    })),
    ...(movers.rest.companies > 0
      ? [
          {
            id: "rest",
            mover: null,
            rest: movers.rest,
            valueChange: movers.rest.valueChange,
          },
        ]
      : []),
  ];

  const largest = Math.max(
    ...rows.map(({ valueChange }) => Math.abs(valueChange))
  );

  return (
    <table
      aria-label={t("heat-map.movers.title")}
      className="w-full border-separate border-spacing-y-0.5 text-sm tabular-nums">
      <thead className="text-xs text-muted">
        <tr>
          <th className="px-2 pb-1 text-left font-normal">
            {t("heat-map.movers.symbol")}
          </th>
          <th className="px-2 pb-1 text-right font-normal whitespace-nowrap">
            {t("heat-map.movers.percent")}
          </th>
          <th className="px-2 pb-1 text-right font-normal whitespace-nowrap">
            {t("heat-map.movers.value-change")}
          </th>
          <th className="px-2 pb-1 text-right font-normal whitespace-nowrap">
            {t("heat-map.movers.contribution")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ id, mover, rest, valueChange }) => {
          const color = directionOf(direction, valueChange)?.solid;

          return (
            // The row is the bar's containing block, and isolates it so it sits under the text.
            <tr key={id} className="relative isolate h-8">
              <td className="w-full max-w-0 px-2">
                {color ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 -z-10 rounded-md"
                    style={{
                      width: cssPercent(Math.abs(valueChange) / largest),
                      backgroundImage: `linear-gradient(to right, color-mix(in oklab, ${color} 2%, transparent), color-mix(in oklab, ${color} 34%, transparent))`,
                    }}
                  />
                ) : null}
                {mover ? (
                  <Link
                    to="/symbol/$market/$symbol"
                    params={{ market: Market.TW, symbol: mover.symbol }}
                    className="flex min-w-0 items-baseline gap-1.5 hover:underline">
                    <span className="shrink-0 font-medium">{mover.symbol}</span>
                    <ListingName
                      symbol={{ market: Market.TW, symbol: mover.symbol }}
                    />
                  </Link>
                ) : (
                  <span className="text-muted">
                    {t("heat-map.movers.rest", {
                      count: rest?.companies ?? 0,
                    })}
                  </span>
                )}
              </td>
              <td className="px-2 text-right whitespace-nowrap">
                {mover ? format.quotePercentChange.format(mover.percent) : ""}
              </td>
              <td className="px-2 text-right whitespace-nowrap">
                {format.signedCompactAmount.format(valueChange)}
              </td>
              <td className="px-2 text-right whitespace-nowrap">
                {contribution(valueChange)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Which companies moved a sector picked here over the exchange's last session. */
export function SectorMovers() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const [sector, setSector] = useState<TwSector>(TwSector.Semiconductors);
  const { data, error, refetch } = useQuery(sectorMoversQuery(sector));

  let body;

  if (error) {
    body = <LoadError error={error} onRetry={() => void refetch()} />;
  } else if (data === undefined) {
    body = <LoadingState />;
  } else if (data === null) {
    body = <p className="text-sm text-muted">{t("heat-map.movers.none")}</p>;
  } else {
    body = (
      <>
        <p className="text-xs text-muted tabular-nums">
          {t("heat-map.movers.summary", {
            date: data.date,
            value: format.compactAmount.format(data.marketValue),
            currency: Currency.TWD,
            change: format.signedCompactAmount.format(data.valueChange),
            percent: format.quotePercentChange.format(
              data.valueChange / data.marketValue
            ),
          })}
        </p>
        <MoversTable movers={data} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-60">
        <OptionSelect
          label={t("heat-map.movers.sector")}
          value={sector}
          options={TW_SECTOR_INDICES.map((index) => ({
            id: index.sector,
            label: t(`sectors.names.${index.sector}`),
          }))}
          onChange={setSector}
        />
      </div>
      {body}
    </div>
  );
}
