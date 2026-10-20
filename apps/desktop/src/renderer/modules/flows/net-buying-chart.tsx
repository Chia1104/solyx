import { cn } from "@heroui/react";
import { sumBy, uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Investor } from "@solyx/core/flows";
import type { InvestorTrades } from "@solyx/core/flows";
import { cssPercent } from "@solyx/utils/format";

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
 * the groups together leaned that way.
 */
export function NetBuyingChart({
  trades,
  format,
}: {
  trades: readonly InvestorTrades[];
  format: (amount: number) => string;
}) {
  const { t } = useTranslation();

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

  const highest = Math.max(
    0,
    ...sessions.map(({ nets }) => sumBy(nets, (net) => Math.max(net, 0)))
  );

  const lowest = Math.min(
    0,
    ...sessions.map(({ nets }) => sumBy(nets, (net) => Math.min(net, 0)))
  );

  const span = highest - lowest || 1;
  const zero = -lowest / span;

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
            style={{ bottom: cssPercent(zero) }}
          />
          <ol className="relative flex h-full justify-between gap-1">
            {sessions.map(({ date, nets }) => {
              let above = zero;
              let below = zero;

              return (
                <li
                  key={date}
                  title={[
                    date,
                    ...GROUPS.map(
                      ({ id }, index) =>
                        `${t(`flows.investors.${id}`)} ${format(nets[index])}`
                    ),
                  ].join("\n")}
                  className="relative h-full max-w-4 min-w-1 flex-1">
                  {nets.map((net, index) => {
                    if (net === 0) return null;

                    const height = Math.abs(net) / span;
                    const bottom = net > 0 ? above : below - height;
                    // Stacked on another group, it leaves a line of the page between them.
                    const stacked = net > 0 ? above > zero : below < zero;

                    if (net > 0) above += height;
                    else below -= height;

                    return (
                      <span
                        key={GROUPS[index].id}
                        className={cn(
                          "absolute inset-x-0 border-background",
                          stacked && (net > 0 ? "border-b" : "border-t")
                        )}
                        style={{
                          bottom: cssPercent(bottom),
                          height: cssPercent(height),
                          backgroundColor: GROUPS[index].color,
                        }}
                      />
                    );
                  })}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <figcaption className="flex justify-between text-[10px] text-muted tabular-nums">
        <span>{dates[0]}</span>
        <span>{dates.at(-1)}</span>
      </figcaption>
    </figure>
  );
}
