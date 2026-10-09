import type { ReactNode } from "react";

import { Table } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { netBuying } from "@solyx/core/flows";
import type { BalanceTrend, InvestorTrades } from "@solyx/core/flows";

const NUMBER = "text-end tabular-nums";

/** A table's title, with the session its figures run through. */
function Caption({ title, through }: { title: string; through: string }) {
  const { t } = useTranslation();

  return (
    <h4 className="flex items-baseline gap-2 text-xs font-medium text-muted">
      {title}
      <span className="font-normal tabular-nums">
        {t("flows.through", { date: through.slice("YYYY-".length) })}
      </span>
    </h4>
  );
}

/**
 * Each investor group's net buying over a session, a week and a month of sessions, and its run of
 * sessions on one side, each figure as `format` writes it.
 */
export function NetBuyingTable({
  title,
  trades,
  format,
}: {
  title: string;
  trades: readonly InvestorTrades[];
  format: (value: number) => string;
}) {
  const { t } = useTranslation();
  const through = trades.at(-1)?.date;

  if (through === undefined) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <Caption title={title} through={through} />
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={title}>
            <Table.Header>
              <Table.Column isRowHeader>{t("flows.investor")}</Table.Column>
              <Table.Column className={NUMBER}>
                {t("flows.session")}
              </Table.Column>
              <Table.Column className={NUMBER}>{t("flows.week")}</Table.Column>
              <Table.Column className={NUMBER}>{t("flows.month")}</Table.Column>
              <Table.Column className="text-end">{t("flows.run")}</Table.Column>
            </Table.Header>
            <Table.Body>
              {netBuying(trades).map(
                ({ investor, session, week, month, streak }) => (
                  <Table.Row key={investor} id={investor}>
                    <Table.Cell>{t(`flows.investors.${investor}`)}</Table.Cell>
                    <Table.Cell className={NUMBER}>
                      {format(session)}
                    </Table.Cell>
                    <Table.Cell className={NUMBER}>{format(week)}</Table.Cell>
                    <Table.Cell className={NUMBER}>{format(month)}</Table.Cell>
                    <Table.Cell className="text-end text-muted tabular-nums">
                      {streak > 0
                        ? t("flows.bought-run", { sessions: streak })
                        : streak < 0
                          ? t("flows.sold-run", { sessions: -streak })
                          : "—"}
                    </Table.Cell>
                  </Table.Row>
                )
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </section>
  );
}

export interface TrendRow {
  id: string;
  label: string;
  /** What the balance means beside its size, such as how much of a limit it uses. */
  detail?: ReactNode;
  trend: BalanceTrend;
  /** Writes the balance. */
  value: (value: number) => string;
  /** Writes a change of it. */
  change: (value: number) => string;
}

/** Balances at the newest session, each with its change over a session, a week and a month of sessions. */
export function TrendTable({
  title,
  label,
  rows,
}: {
  title: string;
  /** What the first column names. */
  label: string;
  rows: TrendRow[];
}) {
  const { t } = useTranslation();

  const through = rows
    .map(({ trend }) => trend.date)
    .toSorted()
    .at(-1);

  if (through === undefined) return null;

  const changed = (row: TrendRow, value: number | null) =>
    value === null ? "—" : row.change(value);

  return (
    <section className="flex flex-col gap-1.5">
      <Caption title={title} through={through} />
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={title}>
            <Table.Header>
              <Table.Column isRowHeader>{label}</Table.Column>
              <Table.Column className={NUMBER}>
                {t("flows.latest")}
              </Table.Column>
              <Table.Column className={NUMBER}>
                {t("flows.session")}
              </Table.Column>
              <Table.Column className={NUMBER}>{t("flows.week")}</Table.Column>
              <Table.Column className={NUMBER}>{t("flows.month")}</Table.Column>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.id} id={row.id}>
                  <Table.Cell>
                    <span className="flex flex-col">
                      {row.label}
                      {row.detail ? (
                        <span className="text-xs text-muted tabular-nums">
                          {row.detail}
                        </span>
                      ) : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell className={NUMBER}>
                    {row.value(row.trend.value)}
                  </Table.Cell>
                  <Table.Cell className={NUMBER}>
                    {changed(row, row.trend.session)}
                  </Table.Cell>
                  <Table.Cell className={NUMBER}>
                    {changed(row, row.trend.week)}
                  </Table.Cell>
                  <Table.Cell className={NUMBER}>
                    {changed(row, row.trend.month)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </section>
  );
}
