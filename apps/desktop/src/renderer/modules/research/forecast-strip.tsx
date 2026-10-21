import type { PointerEvent } from "react";

import { cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { Forecast } from "@solyx/core/forecast";
import { cssPercent } from "@solyx/utils/format";

import {
  ChartTooltip,
  useChartHover,
} from "../../components/chart-tooltip.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { forecastMarks } from "./research-figures.ts";
import type { ForecastMark } from "./research-figures.ts";

// As many as stay apart in the narrowest column the panel gives the forecasts.
const MARKS = 24;

// A mark narrows before the strip outgrows its column.
const SLOT = "h-full max-w-3 min-w-1 flex-1";

function Mark({
  mark,
  description,
  faded,
  onPointerMove,
}: {
  mark: ForecastMark;
  description: string;
  faded: boolean;
  onPointerMove: (event: PointerEvent) => void;
}) {
  const { settled } = mark;

  if (!settled) {
    return (
      <li
        // Pencil until it settles, as its card is.
        className={cn(
          SLOT,
          "rounded-t-[2px] border border-b-0 border-dashed border-border hatch",
          faded && "opacity-40"
        )}
        onPointerMove={onPointerMove}>
        <span className="sr-only">{description}</span>
      </li>
    );
  }

  return (
    <li
      className={cn(SLOT, "relative", faded && "opacity-40")}
      onPointerMove={onPointerMove}>
      <span className="sr-only">{description}</span>
      <span
        className={cn(
          "absolute inset-x-0 bottom-0 min-h-px rounded-t-[2px]",
          settled.led ? "bg-accent" : "bg-muted"
        )}
        style={{ height: cssPercent(settled.given) }}
      />
      {settled.history === null ? null : (
        <i
          className="absolute -inset-x-px h-px bg-foreground"
          style={{ bottom: cssPercent(settled.history) }}
        />
      )}
    </li>
  );
}

/**
 * The record at a glance: what each forecast gave the band that held, against what the listing's
 * history gave it, each named as it is hovered. Nothing is drawn until two forecasts stand and one
 * has settled, since one column compares with nothing.
 */
export function ForecastStrip({
  forecasts,
}: {
  forecasts: readonly Forecast[];
}) {
  const { t, i18n } = useTranslation();
  const { percent } = numberFormats(i18n.language);
  const { hover, show, hide } = useChartHover();
  const marks = forecastMarks(forecasts, MARKS);
  const settled = marks.flatMap((mark) => mark.settled ?? []);

  if (marks.length < 2 || settled.length === 0) return null;

  const describe = ({ date, settled: mark }: ForecastMark) => {
    if (!mark) return t("research.forecasts.mark-open", { date });

    const given = percent.format(mark.given);

    return mark.history === null
      ? t("research.forecasts.mark", { date, given })
      : t("research.forecasts.mark-history", {
          date,
          given,
          history: percent.format(mark.history),
        });
  };

  const hovered = hover ? marks[hover.index] : undefined;

  return (
    <figure className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <div
          aria-hidden
          className="flex flex-col justify-between text-[10px] leading-none text-muted tabular-nums">
          <span>{percent.format(1)}</span>
          <span>{percent.format(0)}</span>
        </div>
        <ol
          className="flex h-14 min-w-0 flex-1 items-end gap-[3px] border-b border-separator"
          onPointerLeave={hide}>
          {marks.map((mark, index) => (
            <Mark
              key={mark.id}
              mark={mark}
              description={describe(mark)}
              faded={hover !== null && hover.index !== index}
              onPointerMove={(event) => show(index, event)}
            />
          ))}
        </ol>
      </div>
      <figcaption className="text-xs text-muted tabular-nums">
        {t("research.forecasts.strip", {
          settled: settled.length,
          led: settled.filter(({ led }) => led).length,
        })}
      </figcaption>
      <ChartTooltip hover={hover}>
        {hovered ? describe(hovered) : null}
      </ChartTooltip>
    </figure>
  );
}
