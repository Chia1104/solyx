import { useState } from "react";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import { ROTATION_PERIODS, RotationInterval } from "@solyx/core/rotation";
import type { RotationReading } from "@solyx/core/rotation";
import { isEnumValue } from "@solyx/utils/is";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { LINE_COLORS } from "./chart-palette.ts";
import { numberFormats } from "./number-formats.ts";
import { listingRotationQuery } from "./quote-query.ts";
import { RotationPlot } from "./rotation-graph.tsx";
import type { PlacedEntry } from "./rotation-graph.tsx";

/** The period picked first in each interval: a quarter of sessions, or half a year of weeks. */
const DEFAULT_PERIOD: Record<RotationInterval, number> = {
  [RotationInterval.Daily]: 60,
  [RotationInterval.Weekly]: 26,
};

/** The line against the market's index, and the one against the listing's own sector's. */
const Against = {
  Index: "index",
  Sector: "sector",
} as const;

type Against = (typeof Against)[keyof typeof Against];

const COLORS: Record<Against, string> = {
  [Against.Index]: LINE_COLORS.fast,
  [Against.Sector]: LINE_COLORS.slow,
};

/**
 * One listing on the rotation graph over a period picked here: against its market's index and,
 * for a TWSE company whose industry has an index, against that index too, each line read out in
 * words beside the plot.
 */
export function ListingRotation({ symbol }: { symbol: SymbolRef }) {
  const { t, i18n } = useTranslation();
  const { signedIndicator } = numberFormats(i18n.language);

  const [interval, setInterval] = useState<RotationInterval>(
    RotationInterval.Daily
  );

  const [period, setPeriod] = useState(DEFAULT_PERIOD[interval]);
  const [focused, setFocused] = useState<string | null>(null);
  const { data, error, refetch } = useQuery(listingRotationQuery(symbol));

  const quadrantName = (quadrant: RotationReading["quadrant"]) =>
    quadrant ? t(`heat-map.rotation.quadrants.${quadrant}`) : null;

  let body;

  if (error) {
    body = <LoadError error={error} onRetry={() => void refetch()} />;
  } else if (data === undefined) {
    body = <LoadingState />;
  } else {
    const lines: { id: Against; name: string; readings: RotationReading[] }[] =
      [
        {
          id: Against.Index,
          name: t("heat-map.rotation.against", { name: data.index.name }),
          readings: data.index.readings,
        },
        ...(data.sector
          ? [
              {
                id: Against.Sector,
                name: t("heat-map.rotation.against", {
                  name: t("heat-map.rotation.sector-index", {
                    sector: t(`sectors.names.${data.sector.sector}`),
                  }),
                }),
                readings: data.sector.readings,
              },
            ]
          : []),
      ];

    const placed = lines.flatMap((line): PlacedEntry[] => {
      const reading = line.readings.find(
        (each) => each.interval === interval && each.period === period
      );

      return reading?.quadrant
        ? [{ ...line, group: line.id, color: COLORS[line.id], reading }]
        : [];
    });

    body = (
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="w-56 shrink-0">
          {placed.length > 0 ? (
            <RotationPlot
              placed={placed}
              focused={focused}
              onFocus={setFocused}
              className="aspect-square"
            />
          ) : (
            <p className="text-xs text-muted">{t("heat-map.rotation.none")}</p>
          )}
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
          {lines.map((line) => {
            const reading = line.readings.find(
              (each) => each.interval === interval && each.period === period
            );

            const last = reading?.trail.at(-1);

            return (
              <li
                key={line.id}
                className="flex flex-col gap-0.5"
                onPointerEnter={() => setFocused(line.id)}
                onPointerLeave={() => setFocused(null)}>
                <p className="flex items-center gap-1.5 font-medium">
                  <i
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COLORS[line.id] }}
                  />
                  {line.name}
                </p>
                {reading?.quadrant && last ? (
                  <p className="text-muted tabular-nums">
                    {t("heat-map.rotation.reading", {
                      quadrant: quadrantName(reading.quadrant),
                      level: signedIndicator.format(last.level),
                      momentum: signedIndicator.format(last.momentum),
                    })}
                    {reading.transition
                      ? ` · ${t("heat-map.rotation.crossed")} ${t(
                          "heat-map.rotation.crossed-from",
                          {
                            date: reading.transition.date,
                            from: quadrantName(reading.transition.from),
                          }
                        )}`
                      : null}
                  </p>
                ) : (
                  <p className="text-muted">{t("heat-map.rotation.none")}</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        {t("heat-map.rotation.listing-title")}
        <span className="flex flex-wrap gap-2">
          <ToggleButtonGroup
            aria-label={t("heat-map.rotation.bars")}
            selectionMode="single"
            disallowEmptySelection
            size="sm"
            selectedKeys={[interval]}
            onSelectionChange={(keys) => {
              const [next] = keys;

              if (isEnumValue(RotationInterval, next)) {
                setInterval(next);
                setPeriod(DEFAULT_PERIOD[next]);
              }
            }}>
            {Object.values(RotationInterval).map((each) => (
              <ToggleButton key={each} id={each}>
                {t(`heat-map.rotation.intervals.${each}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <ToggleButtonGroup
            aria-label={t("heat-map.rotation.period")}
            selectionMode="single"
            disallowEmptySelection
            size="sm"
            selectedKeys={[String(period)]}
            onSelectionChange={(keys) => {
              const next = ROTATION_PERIODS[interval].find((each) =>
                keys.has(String(each))
              );

              if (next !== undefined) setPeriod(next);
            }}>
            {ROTATION_PERIODS[interval].map((each) => (
              <ToggleButton key={each} id={String(each)}>
                {t(`heat-map.rotation.periods.${interval}`, { count: each })}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </span>
      </h3>
      {body}
    </section>
  );
}
