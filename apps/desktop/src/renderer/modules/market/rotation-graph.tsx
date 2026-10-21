import { useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { scaleLinear } from "d3-scale";
import { orderBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import { Quadrant, ROTATION_PERIODS } from "@solyx/core/rotation";
import type { RotationReading } from "@solyx/core/rotation";
import { cssPercent } from "@solyx/utils/format";

import { ChartMark } from "../../components/chart-mark.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

import { numberFormats } from "./number-formats.ts";

/** One line of the graph: a sector or a listing, in its group's colour. */
export interface RotationEntry {
  id: string;
  /** What the mark is named, in words. */
  name: string;
  /** What the lists show of it; `name` where left out. */
  title?: ReactNode;
  group: string;
  readings: RotationReading[];
  /** The listing its row opens, where it is one. */
  symbol?: SymbolRef;
}

export interface RotationGroup {
  id: string;
  label: string;
  color: string;
}

/** The quadrants in the order a rotation runs through them, from where an entry leads. */
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

/** The filter's choice that keeps every group. */
const EVERY_GROUP = "every";

/** An entry with its colour and its reading over the period shown. */
export interface PlacedEntry extends RotationEntry {
  color: string;
  reading: RotationReading;
}

/**
 * Every entry's trail over the period, one line each in its group's colour, ending in a dot that
 * names the entry and its reading as it is pointed at; the quadrants meet at the origin. Pointing
 * at an entry, here or in the lists under the plot, lifts its line over the rest.
 */
export function RotationPlot({
  placed,
  focused,
  onFocus,
  className,
}: {
  placed: readonly PlacedEntry[];
  focused: string | null;
  onFocus: (id: string | null) => void;
  /** Sizes the plot; four by three, no taller than the overview's, where left out. */
  className?: string;
}) {
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

  // The focused line is drawn last, so it lies over the rest.
  const drawn = orderBy(placed, [({ id }) => id === focused], ["asc"]);

  return (
    <div
      className={cn(
        "relative w-full rounded-sm pencil",
        className ?? "aspect-[4/3] max-h-80"
      )}>
      {QUADRANT_ORDER.map((quadrant) => (
        <span
          key={quadrant}
          aria-hidden
          className={`absolute text-[10px] leading-none text-muted ${QUADRANT_CORNERS[quadrant]}`}>
          {quadrantName(quadrant)}
        </span>
      ))}
      <span
        aria-hidden
        className="absolute top-1 left-1/2 ml-1 text-[10px] leading-none text-muted">
        {t("heat-map.rotation.momentum")}
      </span>
      <span
        aria-hidden
        className="absolute top-1/2 right-1.5 -translate-y-full pb-0.5 text-[10px] leading-none text-muted">
        {t("heat-map.rotation.level")}
      </span>
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
        {drawn.map(({ id, color, reading }) => {
          const lifted = focused === id;

          return (
            <polyline
              key={id}
              points={reading.trail
                .map((stop) => `${x(stop.level)},${y(stop.momentum)}`)
                .join(" ")}
              fill="none"
              stroke={color}
              strokeOpacity={lifted ? 1 : focused ? 0.12 : 0.45}
              strokeWidth={lifted ? 2.5 : 1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="transition-[stroke-opacity]"
            />
          );
        })}
      </svg>
      <ol>
        {drawn.map(({ id, name, title, color, reading }) => {
          const last = reading.trail.at(-1)!;
          const quadrant = quadrantName(reading.quadrant!);
          const level = signedIndicator.format(last.level);
          const momentum = signedIndicator.format(last.momentum);

          return (
            <li
              key={id}
              onPointerEnter={() => onFocus(id)}
              onPointerLeave={() => onFocus(null)}
              onFocus={() => onFocus(id)}
              onBlur={() => onFocus(null)}>
              <ChartMark
                label={t("heat-map.rotation.mark", {
                  name,
                  quadrant,
                  level,
                  momentum,
                })}
                tooltip={
                  <>
                    <p>
                      <span className="font-semibold">{title ?? name}</span>{" "}
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
                className={cn(
                  "inset-auto -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background transition-[opacity,width,height]",
                  focused === id ? "size-3.5" : "size-2.5",
                  focused && focused !== id && "opacity-30"
                )}
                style={{
                  left: cssPercent(x(last.level) / 100),
                  top: cssPercent(y(last.momentum) / 100),
                  backgroundColor: color,
                }}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The entries in each quadrant, the highest level first, in their group's colour; a listing's row opens its page. */
function QuadrantLists({
  placed,
  focused,
  onFocus,
}: {
  placed: readonly PlacedEntry[];
  focused: string | null;
  onFocus: (id: string | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs @md/main:grid-cols-4">
      {QUADRANT_ORDER.map((quadrant) => (
        <li key={quadrant} className="flex flex-col gap-1">
          <p className="font-medium">
            {t(`heat-map.rotation.quadrants.${quadrant}`)}
          </p>
          <ol className="flex flex-col gap-0.5">
            {orderBy(
              placed.filter(({ reading }) => reading.quadrant === quadrant),
              [({ reading }) => reading.trail.at(-1)?.level ?? 0],
              ["desc"]
            ).map(({ id, name, title, color, symbol }) => {
              const content = (
                <>
                  <i
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 truncate">{title ?? name}</span>
                </>
              );

              const className = cn(
                "flex min-w-0 items-center gap-1.5 transition-colors",
                focused === id ? "text-foreground" : "text-muted",
                focused && focused !== id && "opacity-50"
              );

              return (
                <li
                  key={id}
                  onPointerEnter={() => onFocus(id)}
                  onPointerLeave={() => onFocus(null)}
                  onFocus={() => onFocus(id)}
                  onBlur={() => onFocus(null)}>
                  {symbol ? (
                    <Link
                      to="/symbol/$market/$symbol"
                      params={symbol}
                      className={cn(className, "hover:underline")}>
                      {content}
                    </Link>
                  ) : (
                    <span className={className}>{content}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ul>
  );
}

/**
 * Entries on a relative rotation graph over a period picked here, in their group's colour, with
 * a filter down to one group where there are several; under the plot, the groups' colours and the
 * entries by quadrant.
 */
export function RotationGraph({
  entries,
  groups,
}: {
  entries: readonly RotationEntry[];
  groups: readonly RotationGroup[];
}) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [group, setGroup] = useState(EVERY_GROUP);
  const [focused, setFocused] = useState<string | null>(null);

  const colors = new Map(groups.map((each) => [each.id, each.color]));

  const placed = entries.flatMap((entry): PlacedEntry[] => {
    const reading = entry.readings.find((each) => each.period === period);
    const color = colors.get(entry.group);

    if (
      !reading?.quadrant ||
      color === undefined ||
      (group !== EVERY_GROUP && entry.group !== group)
    ) {
      return [];
    }

    return [{ ...entry, color, reading }];
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <OptionSelect
          label={t("heat-map.rotation.period")}
          value={String(period)}
          options={ROTATION_PERIODS.map((each) => ({
            id: String(each),
            label: t("heat-map.rotation.sessions", { count: each }),
          }))}
          onChange={(id) => setPeriod(Number(id))}
          className="w-44"
        />
        {groups.length > 1 ? (
          <OptionSelect
            label={t("heat-map.rotation.group")}
            value={group}
            options={[
              { id: EVERY_GROUP, label: t("heat-map.rotation.every-group") },
              ...groups.map(({ id, label }) => ({ id, label })),
            ]}
            onChange={setGroup}
            className="w-44"
          />
        ) : null}
      </div>
      {placed.length === 0 ? (
        <p className="text-sm text-muted">{t("heat-map.rotation.none")}</p>
      ) : (
        <>
          <RotationPlot
            placed={placed}
            focused={focused}
            onFocus={setFocused}
          />
          <ul className="flex flex-wrap gap-3 text-xs text-muted">
            {groups.map(({ id, label, color }) => (
              <li key={id} className="flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {label}
              </li>
            ))}
          </ul>
          <QuadrantLists
            placed={placed}
            focused={focused}
            onFocus={setFocused}
          />
        </>
      )}
    </div>
  );
}
