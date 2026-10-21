import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { scaleLinear } from "d3-scale";
import { orderBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Quadrant, ROTATION_PERIODS } from "@solyx/core/rotation";
import type {
  RotationReading,
  SectorRotation as Rotation,
} from "@solyx/core/rotation";
import { SectorGroup } from "@solyx/core/sectors";
import type { TwSector } from "@solyx/core/sectors";
import { cssPercent } from "@solyx/utils/format";

import { ChartMark } from "../../components/chart-mark.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

import { LINE_COLORS } from "./chart-palette.ts";
import { numberFormats } from "./number-formats.ts";
import { rotationsQuery } from "./quote-query.ts";

/** One colour per group of sectors, none of them a price's. */
const GROUP_COLORS: Record<SectorGroup, string> = {
  [SectorGroup.Electronics]: LINE_COLORS.fast,
  [SectorGroup.Finance]: LINE_COLORS.slow,
  [SectorGroup.Other]: LINE_COLORS.oscillator,
};

/** The quadrants in the order a rotation runs through them, from where a sector leads. */
const QUADRANT_ORDER = [
  Quadrant.Leading,
  Quadrant.Weakening,
  Quadrant.Lagging,
  Quadrant.Improving,
];

/** Where each quadrant's name sits in the plot. */
const QUADRANT_CORNERS: Record<Quadrant, string> = {
  [Quadrant.Leading]: "top-1 right-1.5",
  [Quadrant.Weakening]: "bottom-1 right-1.5",
  [Quadrant.Lagging]: "bottom-1 left-1.5",
  [Quadrant.Improving]: "top-1 left-1.5",
};

/** Each axis reaches at least this many standard deviations, so a quiet market does not fill the plot. */
const LEAST_REACH = 1.5;

const DEFAULT_PERIOD = 60;

interface Placed {
  sector: TwSector;
  group: SectorGroup;
  reading: RotationReading;
}

/**
 * Every sector's trail over the period, one line each in its group's colour, ending in a dot that
 * names the sector and its reading as it is pointed at; the quadrants meet at the origin.
 */
function RotationPlot({ placed }: { placed: readonly Placed[] }) {
  const { t, i18n } = useTranslation();
  const { signedIndicator } = numberFormats(i18n.language);

  const reach = (pick: (stop: { level: number; momentum: number }) => number) =>
    Math.max(
      LEAST_REACH,
      ...placed.flatMap(({ reading }) =>
        reading.trail.map((stop) => Math.abs(pick(stop)))
      )
    );

  const x = scaleLinear()
    .domain([-reach((stop) => stop.level), reach((stop) => stop.level)])
    .range([0, 100]);

  const y = scaleLinear()
    .domain([-reach((stop) => stop.momentum), reach((stop) => stop.momentum)])
    .range([100, 0]);

  const quadrantName = (quadrant: Quadrant) =>
    t(`heat-map.rotation.quadrants.${quadrant}`);

  return (
    <div className="flex gap-2">
      <span
        aria-hidden
        className="shrink-0 rotate-180 self-center text-[10px] leading-none text-muted [writing-mode:vertical-rl]">
        {t("heat-map.rotation.momentum")}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="relative aspect-[4/3] max-h-80 w-full rounded-sm pencil">
          {QUADRANT_ORDER.map((quadrant) => (
            <span
              key={quadrant}
              aria-hidden
              className={`absolute text-[10px] leading-none text-muted ${QUADRANT_CORNERS[quadrant]}`}>
              {quadrantName(quadrant)}
            </span>
          ))}
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible">
            <g
              className="text-muted/60"
              stroke="currentColor"
              strokeDasharray="2 2">
              <line
                x1={0}
                y1={50}
                x2={100}
                y2={50}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={50}
                y1={0}
                x2={50}
                y2={100}
                vectorEffect="non-scaling-stroke"
              />
            </g>
            {placed.map(({ sector, group, reading }) => (
              <polyline
                key={sector}
                points={reading.trail
                  .map((stop) => `${x(stop.level)},${y(stop.momentum)}`)
                  .join(" ")}
                fill="none"
                stroke={GROUP_COLORS[group]}
                strokeOpacity={0.6}
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <ol>
            {placed.map(({ sector, group, reading }) => {
              const last = reading.trail.at(-1)!;
              const name = t(`sectors.names.${sector}`);
              const quadrant = quadrantName(reading.quadrant!);
              const level = signedIndicator.format(last.level);
              const momentum = signedIndicator.format(last.momentum);

              return (
                <li key={sector}>
                  <ChartMark
                    label={t("heat-map.rotation.mark", {
                      sector: name,
                      quadrant,
                      level,
                      momentum,
                    })}
                    tooltip={
                      <>
                        <p>
                          <span className="font-semibold">{name}</span>{" "}
                          {quadrant}
                        </p>
                        <dl className="grid grid-cols-[auto_auto] gap-x-3 text-xs">
                          <dt className="text-muted">
                            {t("heat-map.rotation.level")}
                          </dt>
                          <dd className="text-right">{level}</dd>
                          <dt className="text-muted">
                            {t("heat-map.rotation.momentum")}
                          </dt>
                          <dd className="text-right">{momentum}</dd>
                          {reading.transition ? (
                            <>
                              <dt className="text-muted">
                                {t("heat-map.rotation.crossed")}
                              </dt>
                              <dd className="text-right">
                                {t("heat-map.rotation.crossed-from", {
                                  date: reading.transition.date,
                                  from: quadrantName(reading.transition.from),
                                })}
                              </dd>
                            </>
                          ) : null}
                        </dl>
                      </>
                    }
                    className="inset-auto size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
                    style={{
                      left: cssPercent(x(last.level) / 100),
                      top: cssPercent(y(last.momentum) / 100),
                      backgroundColor: GROUP_COLORS[group],
                    }}
                  />
                </li>
              );
            })}
          </ol>
        </div>
        <span
          aria-hidden
          className="text-center text-[10px] leading-none text-muted">
          {t("heat-map.rotation.level")}
        </span>
      </div>
    </div>
  );
}

/** The sectors in each quadrant, the highest level first, in their group's colour. */
function QuadrantLists({ placed }: { placed: readonly Placed[] }) {
  const { t } = useTranslation();

  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs @md/main:grid-cols-4">
      {QUADRANT_ORDER.map((quadrant) => (
        <li key={quadrant} className="flex flex-col gap-1">
          <p className="font-medium">
            {t(`heat-map.rotation.quadrants.${quadrant}`)}
          </p>
          <ol className="flex flex-col gap-0.5 text-muted">
            {orderBy(
              placed.filter(({ reading }) => reading.quadrant === quadrant),
              [({ reading }) => reading.trail.at(-1)?.level ?? 0],
              ["desc"]
            ).map(({ sector, group }) => (
              <li key={sector} className="flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: GROUP_COLORS[group] }}
                />
                {t(`sectors.names.${sector}`)}
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}

/** Taiwan's listed sectors on a relative rotation graph against the TAIEX, over a period picked here. */
export function SectorRotation() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const { data, error, refetch } = useQuery(rotationsQuery());

  let body;

  if (error) {
    body = <LoadError error={error} onRetry={() => void refetch()} />;
  } else if (data === undefined) {
    body = <LoadingState />;
  } else if (data === null) {
    body = (
      <p className="text-sm text-muted">{t("heat-map.sectors.unavailable")}</p>
    );
  } else {
    const placed = data.flatMap(({ sector, group, readings }: Rotation) => {
      const reading = readings.find((each) => each.period === period);

      return reading?.quadrant ? [{ sector, group, reading }] : [];
    });

    body =
      placed.length === 0 ? (
        <p className="text-sm text-muted">{t("heat-map.rotation.none")}</p>
      ) : (
        <>
          <RotationPlot placed={placed} />
          <ul className="flex flex-wrap gap-3 text-xs text-muted">
            {Object.values(SectorGroup).map((group) => (
              <li key={group} className="flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: GROUP_COLORS[group] }}
                />
                {t(`sectors.groups.${group}`)}
              </li>
            ))}
          </ul>
          <QuadrantLists placed={placed} />
        </>
      );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-60">
        <OptionSelect
          label={t("heat-map.rotation.period")}
          value={String(period)}
          options={ROTATION_PERIODS.map((each) => ({
            id: String(each),
            label: t("heat-map.rotation.sessions", { count: each }),
          }))}
          onChange={(id) => setPeriod(Number(id))}
        />
      </div>
      {body}
    </div>
  );
}
