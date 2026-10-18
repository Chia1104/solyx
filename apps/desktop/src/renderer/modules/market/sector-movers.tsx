import { useState } from "react";

import { Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Currency, Market } from "@solyx/core/market";
import { TW_SECTOR_INDICES, TwSector } from "@solyx/core/sectors";
import type { SectorMovers as Movers } from "@solyx/core/sectors";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { sectorMoversQuery } from "../fundamentals/fundamentals-query.ts";

import { ListingName } from "./listing-name.tsx";
import { numberFormats } from "./number-formats.ts";

/** The companies that moved one sector's market value most, the rest in one row. */
function MoversTable({ movers }: { movers: Movers }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  // A company's part of the sector's move, in points of its market value, which add up to the move.
  const contribution = (value: number) =>
    format.quotePercentChange.format(value / movers.marketValue);

  const rows = [
    ...movers.movers.map((mover) => ({ id: mover.symbol, mover, rest: null })),
    ...(movers.rest.companies > 0
      ? [{ id: "rest", mover: null, rest: movers.rest }]
      : []),
  ];

  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={t("heat-map.movers.title")}>
          <Table.Header>
            <Table.Column isRowHeader>
              {t("heat-map.movers.symbol")}
            </Table.Column>
            <Table.Column>{t("heat-map.movers.percent")}</Table.Column>
            <Table.Column>{t("heat-map.movers.value-change")}</Table.Column>
            <Table.Column>{t("heat-map.movers.contribution")}</Table.Column>
          </Table.Header>
          <Table.Body>
            <Table.Collection items={rows}>
              {({ id, mover, rest }) => (
                <Table.Row id={id}>
                  <Table.Cell>
                    {mover ? (
                      <Link
                        to="/symbol/$market/$symbol"
                        params={{ market: Market.TW, symbol: mover.symbol }}
                        className="flex min-w-0 items-baseline gap-1.5 hover:underline">
                        <span className="shrink-0 font-medium">
                          {mover.symbol}
                        </span>
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
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {mover
                      ? format.quotePercentChange.format(mover.percent)
                      : ""}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {format.signedCompactAmount.format(
                      mover?.valueChange ?? rest?.valueChange ?? 0
                    )}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {contribution(mover?.valueChange ?? rest?.valueChange ?? 0)}
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Collection>
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
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
