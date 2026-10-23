import { Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { recordsByStance } from "@solyx/core/review";
import type { CurrencyRecord, TradeRecord } from "@solyx/core/review";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { numberFormats } from "../market/number-formats.ts";

/** One currency's round trips: all of them, then by the stance of the report each was opened under. */
function RecordTable({ currency, all, stances }: CurrencyRecord) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const amount = (value: number | null) =>
    value === null ? "—" : format.signedAmount.format(value);

  const rows: { id: string; label: string; record: TradeRecord }[] = [
    { id: "all", label: t("review.all"), record: all },
    ...stances.map(({ stance, record }) => ({
      id: stance ?? "none",
      label:
        stance === null
          ? t("review.no-report")
          : t(`research.stance.${stance}`),
      record,
    })),
  ];

  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={t("review.table", { currency })}>
          <Table.Header>
            <Table.Column isRowHeader>
              {t("review.stance", { currency })}
            </Table.Column>
            <Table.Column>{t("review.trips")}</Table.Column>
            <Table.Column>{t("review.win-rate")}</Table.Column>
            <Table.Column>{t("review.average-win")}</Table.Column>
            <Table.Column>{t("review.average-loss")}</Table.Column>
            <Table.Column>{t("review.payoff-ratio")}</Table.Column>
            <Table.Column>{t("review.realized")}</Table.Column>
          </Table.Header>
          <Table.Body>
            <Table.Collection items={rows}>
              {({ id, label, record }) => (
                <Table.Row id={id}>
                  <Table.Cell>{label}</Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {record.trips}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {record.winRate === null
                      ? "—"
                      : format.percent.format(record.winRate)}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {amount(record.averageWin)}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {amount(record.averageLoss)}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {record.payoffRatio === null
                      ? "—"
                      : format.indicator.format(record.payoffRatio)}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {amount(record.realized)}
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

/** How the account's closed round trips went, by the research they were opened under. */
export function TradeReview() {
  const { t } = useTranslation();

  const { data, error, refetch } = useQuery(
    orpc.account.roundTrips.queryOptions()
  );

  const records = data && recordsByStance(data);

  return (
    <Section title={t("review.title")} description={t("review.description")}>
      {error ? (
        <LoadError error={error} onRetry={() => void refetch()} />
      ) : !records ? (
        <LoadingState />
      ) : records.length === 0 ? (
        <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
          {t("review.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {records.map((record) => (
            <RecordTable key={record.currency} {...record} />
          ))}
        </div>
      )}
    </Section>
  );
}
