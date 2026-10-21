import { cn } from "@heroui/react";
import { scaleLinear } from "d3-scale";
import { stack, stackOffsetDiverging } from "d3-shape";
import { sumBy, uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Investor } from "@solyx/core/flows";
import type { InvestorTrades } from "@solyx/core/flows";
import { cssPercent } from "@solyx/utils/format";

import {
  ChartTooltip,
  useChartHover,
} from "../../components/chart-tooltip.tsx";
import { LINE_COLORS } from "../market/chart-palette.ts";

/** About a month of sessions. */
const SESSIONS = 20;

/** The groups stacked, in the colours their panes take under a listing's chart. */
const GROUPS: { id: Investor; investors: Investor[]; color: string }[] = [
  {
    id: Investor.Foreign,
    investors: [Investor.Foreign],
    color: LINE_COLORS.fast,
  },
  {
    id: Investor.InvestmentTrust,
    investors: [Investor.InvestmentTrust],
    color: LINE_COLORS.slow,
  },
  // Dealers hedging the warrants they issued count among dealers, as the exchange's totals do.
  {
    id: Investor.Dealer,
    investors: [Investor.Dealer, Investor.DealerHedging],
    color: LINE_COLORS.dealer,
  },
];

/**
 * The newest sessions' net buying by each group, a column a session: what the groups bought
 * stacked above the line and what they sold below it, so a column's reach either way is how much
 * the groups together leaned that way. Hovering a column names each group's figure that session.
 */
export function NetBuyingChart({
  trades,
  format,
}: {
  trades: readonly InvestorTrades[];
  format: (amount: number) => string;
}) {
  const { t } = useTranslation();
  const { hover, show, hide } = useChartHover();

  const dates = uniq(trades.map(({ date }) => date))
    .toSorted()
    .slice(-SESSIONS);

  if (dates.length < 2) return null;

  const sessions = dates.map((date) => ({
    date,
    nets: GROUPS.map(({ investors }) =>
      sumBy(
        trades.filter(
          (trade) => trade.date === date && investors.includes(trade.investor)
        ),
        ({ bought, sold }) => bought - sold
      )
    ),
  }));

  // One series a group, in the groups' order: buying stacked up from zero, selling down from it.
  const series = stack<(typeof sessions)[number], number>()
    .keys(GROUPS.keys())
    .value((session, group) => session.nets[group])
    .offset(stackOffsetDiverging)(sessions);

  const reaches = series.flat().flat();
  const highest = Math.max(0, ...reaches);
  const lowest = Math.min(0, ...reaches);
  const y = scaleLinear().domain([lowest, highest]).range([0, 1]);

  const describe = ({ date, nets }: (typeof sessions)[number]) => [
    date,
    ...GROUPS.map(
      ({ id }, index) => `${t(`flows.investors.${id}`)} ${format(nets[index])}`
    ),
  ];

  const hovered = hover ? sessions[hover.index] : undefined;

  return (
    <figure aria-label={t("flows.net-chart")} className="flex flex-col gap-1.5">
      <ul className="flex gap-3 text-xs text-muted">
        {GROUPS.map(({ id, color }) => (
          <li key={id} className="flex items-center gap-1">
            <i
              aria-hidden
              className="size-2.5 rounded-[2px]"
              style={{ backgroundColor: color }}
            />
            {t(`flows.investors.${id}`)}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <div
          aria-hidden
          className="flex flex-col justify-between text-[10px] leading-none text-muted tabular-nums">
          <span>{format(highest)}</span>
          <span>{format(lowest)}</span>
        </div>
        <div className="relative h-32 min-w-0 flex-1">
          <span
            aria-hidden
            className="absolute inset-x-0 h-px bg-separator"
            style={{ bottom: cssPercent(y(0)) }}
          />
          <ol
            className="relative flex h-full justify-between gap-1"
            onPointerLeave={hide}>
            {sessions.map((session, index) => (
              <li
                key={session.date}
                className={cn(
                  "relative h-full max-w-4 min-w-1 flex-1",
                  hover && hover.index !== index && "opacity-40"
                )}
                onPointerMove={(event) => show(index, event)}>
                <span className="sr-only">{describe(session).join(" ")}</span>
                {series.map((points) => {
                  const [from, to] = points[index];

                  if (from === to) return null;

                  return (
                    <span
                      key={GROUPS[points.key].id}
                      className={cn(
                        "absolute inset-x-0 border-background",
                        // Stacked on another group, it leaves a line of the page between them.
                        from > 0 && "border-b",
                        to < 0 && "border-t"
                      )}
                      style={{
                        bottom: cssPercent(y(from)),
                        height: cssPercent(y(to) - y(from)),
                        backgroundColor: GROUPS[points.key].color,
                      }}
                    />
                  );
                })}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="flex justify-between text-[10px] text-muted tabular-nums">
        <span>{dates[0]}</span>
        <span>{dates.at(-1)}</span>
      </figcaption>
      <ChartTooltip hover={hover}>
        {hovered ? (
          <>
            <span className="font-medium">{hovered.date}</span>
            {GROUPS.map(({ id, color }, group) => (
              <span key={id} className="flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="size-2 rounded-[2px]"
                  style={{ backgroundColor: color }}
                />
                <span className="text-muted">{t(`flows.investors.${id}`)}</span>
                <span className="ml-auto pl-3">
                  {format(hovered.nets[group])}
                </span>
              </span>
            ))}
          </>
        ) : null}
      </ChartTooltip>
    </figure>
  );
}
