import { cn } from "@heroui/react";
import { uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { BENCHMARK } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { ReportStance } from "@solyx/core/report";
import type { StanceSpell } from "@solyx/core/report";
import { cssPercent } from "@solyx/utils/format";

import { ChartMark } from "../../components/chart-mark.tsx";
import { numberFormats } from "../market/number-formats.ts";

/** Ink for a view the report held, and grey for none. */
const STANCE_FILL: Record<ReportStance, string> = {
  [ReportStance.Bullish]: "bg-accent",
  [ReportStance.Bearish]: "bg-warning",
  [ReportStance.Neutral]: "bg-muted",
};

/**
 * Each stretch the report kept one stance, oldest first: as wide as the sessions it ran, raised
 * or lowered by how far the listing outran or trailed its index over them, in its stance's
 * colour, and named as it is pointed at. Drawn once the stance has changed, since one stretch is what
 * the line above says.
 */
export function StanceHistory({
  market,
  spells,
}: {
  market: Market;
  spells: readonly StanceSpell[];
}) {
  const { t, i18n } = useTranslation();
  const { percentChange } = numberFormats(i18n.language);

  if (spells.length < 2) return null;

  const excess = spells.map(({ change, benchmark }) => change - benchmark);
  const largest = Math.max(...excess.map(Math.abs)) || 1;

  const describe = (spell: StanceSpell) =>
    t("research.report.stance-spell", {
      stance: t(`research.stance.${spell.stance}`),
      date: spell.from,
      count: spell.sessions,
      change: percentChange.format(spell.change),
      benchmark: percentChange.format(spell.benchmark),
      index: BENCHMARK[market].totalReturn,
    });

  return (
    <figure
      aria-label={t("research.report.stance-history")}
      className="flex flex-col gap-1.5">
      <ul className="flex gap-3 text-xs text-muted">
        {uniq(spells.map(({ stance }) => stance)).map((stance) => (
          <li key={stance} className="flex items-center gap-1">
            <i
              aria-hidden
              className={cn("size-2.5 rounded-[2px]", STANCE_FILL[stance])}
            />
            {t(`research.stance.${stance}`)}
          </li>
        ))}
      </ul>
      <div className="relative h-14">
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-px bg-separator"
        />
        <ol className="relative flex h-full gap-0.5">
          {spells.map((spell, index) => (
            <li
              key={`${spell.revision}-${spell.from}`}
              className="relative h-full min-w-1"
              style={{ flexGrow: Math.max(spell.sessions, 1) }}>
              <ChartMark label={describe(spell)}>
                <span
                  className={cn(
                    "absolute inset-x-0 min-h-px",
                    excess[index] >= 0
                      ? "bottom-1/2 rounded-t-[2px]"
                      : "top-1/2 rounded-b-[2px]",
                    STANCE_FILL[spell.stance]
                  )}
                  style={{
                    height: cssPercent(Math.abs(excess[index]) / largest / 2),
                  }}
                />
              </ChartMark>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="flex justify-between gap-2 text-[10px] text-muted tabular-nums">
        <span>{spells[0].from}</span>
        <span>
          {t("research.report.stance-history-caption", {
            index: BENCHMARK[market].totalReturn,
          })}
        </span>
        <span>{spells.at(-1)?.until ?? t("research.report.stance-now")}</span>
      </figcaption>
    </figure>
  );
}
