import { useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  Spinner,
  ToggleButton,
  ToggleButtonGroup,
  cn,
} from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { scaleLinear } from "d3-scale";
import { orderBy, uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import {
  Quadrant,
  ROTATION_PERIODS,
  RotationInterval,
  readingThrough,
} from "@solyx/core/rotation";
import type { RotationPath, RotationReading } from "@solyx/core/rotation";
import { cssPercent } from "@solyx/utils/format";
import { isEnumValue } from "@solyx/utils/is";

import { ChartMark } from "../../components/chart-mark.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

import { numberFormats } from "./number-formats.ts";
import { RotationTimeline } from "./rotation-timeline.tsx";

/** One line of the graph: a sector or a listing, in its group's colour. */
export interface RotationEntry {
  id: string;
  /** What the mark is named, in words. */
  name: string;
  /** What the lists show of it; `name` where left out. */
  title?: ReactNode;
  group: string;
  paths: RotationPath[];
  /** The listing its row opens, where it is one. */
  symbol?: SymbolRef;
}

export interface RotationGroup {
  id: string;
  label: string;
  color: string;
}

/** The sessions the graph may be taken back to, oldest first, and the closes of the benchmark that governs every entry, where one does. */
export interface RotationPlayback {
  sessions: readonly string[];
  closes: readonly (number | null)[] | null;
  /** `false` while the older bars are read, so the longer periods begin late or are empty. */
  complete: boolean;
}

/** How far a plot's axes reach either way from the origin, in standard deviations. */
export interface RotationReach {
  level: number;
  momentum: number;
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

/** The period picked first in each interval: a quarter of sessions, or half a year of weeks. */
const DEFAULT_PERIOD: Record<RotationInterval, number> = {
  [RotationInterval.Daily]: 60,
  [RotationInterval.Weekly]: 26,
};

/** No ids, shared so a default keeps its identity across renders. */
const NONE: ReadonlySet<string> = new Set();

/** An entry with its colour and its reading as of the session shown. */
export interface PlacedEntry extends Omit<RotationEntry, "paths"> {
  color: string;
  reading: RotationReading;
}

/** Each axis's reach over `stops`, never under `LEAST_REACH`. */
function reachOf(
  stops: readonly { level: number; momentum: number }[]
): RotationReach {
  let level = LEAST_REACH;
  let momentum = LEAST_REACH;

  for (const stop of stops) {
    level = Math.max(level, Math.abs(stop.level));
    momentum = Math.max(momentum, Math.abs(stop.momentum));
  }

  return { level, momentum };
}

/** The close on each of `frames`, from the closes on `sessions`. */
function closesOn(
  sessions: readonly string[],
  closes: readonly (number | null)[],
  frames: readonly string[]
) {
  const byDay = new Map(sessions.map((day, i) => [day, closes[i]]));

  return frames.map((day) => byDay.get(day) ?? null);
}

/** How strongly a trail's segment `i` of `count` is drawn, the oldest faintest, so the line reads towards its dot. */
const segmentOpacity = (i: number, count: number) =>
  count < 1 ? 1 : 0.2 + (0.8 * (i + 1)) / count;

/**
 * Every entry's trail over the period, one line each in its group's colour that fades towards its
 * start and ends in a dot naming the entry and its reading as it is pointed at; the quadrants meet
 * at the origin. Pointing at an entry, here or in the lists under the plot, lifts its line over
 * the rest and names it beside its dot; given `onPin`, pressing a dot pins it so, and pinned
 * entries stay lifted while others are pointed at.
 */
export function RotationPlot({
  placed,
  focused,
  onFocus,
  pinned = NONE,
  onPin,
  className,
  loading = false,
  reach = reachOf(placed.flatMap(({ reading }) => reading.trail)),
}: {
  placed: readonly PlacedEntry[];
  focused: string | null;
  onFocus: (id: string | null) => void;
  pinned?: ReadonlySet<string>;
  onPin?: (id: string) => void;
  /** Sizes the plot; four by three, no taller than the overview's, where left out. */
  className?: string;
  /** Another reading is on its way: what is drawn is the last one, dimmed, with a spinner over it. */
  loading?: boolean;
  /** How far the axes reach; as far as the trails drawn, where left out. */
  reach?: RotationReach;
}) {
  const { t, i18n } = useTranslation();
  const { signedIndicator } = numberFormats(i18n.language);

  const x = scaleLinear().domain([-reach.level, reach.level]).range([0, 100]);

  const y = scaleLinear()
    .domain([-reach.momentum, reach.momentum])
    .range([100, 0]);

  const quadrantName = (quadrant: Quadrant) =>
    t(`heat-map.rotation.quadrants.${quadrant}`);

  const lifted = (id: string) => focused === id || pinned.has(id);
  const anyLifted = focused !== null || pinned.size > 0;

  // Lifted lines are drawn last, so they lie over the rest.
  const drawn = orderBy(placed, [({ id }) => lifted(id)], ["asc"]);

  return (
    <div
      aria-busy={loading}
      className={cn(
        "relative w-full rounded-sm pencil",
        className ?? "aspect-[4/3] max-h-80"
      )}>
      {loading ? (
        <span
          role="status"
          aria-label={t("common.loading")}
          className="absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-surface/50">
          <Spinner size="sm" color="current" className="text-muted" />
        </span>
      ) : null}
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
        {drawn.map(({ id, color, reading: { trail } }) => {
          const up = lifted(id);
          const opacity = up ? 1 : anyLifted ? 0.12 : 0.45;

          return (
            <g
              key={id}
              stroke={color}
              strokeWidth={up ? 2.5 : 1.5}
              strokeLinecap="round"
              className="transition-[stroke-opacity]"
              strokeOpacity={opacity}>
              {trail.slice(1).map((stop, i) => (
                <line
                  key={stop.date}
                  x1={x(trail[i].level)}
                  y1={y(trail[i].momentum)}
                  x2={x(stop.level)}
                  y2={y(stop.momentum)}
                  opacity={segmentOpacity(i, trail.length - 1)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
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
                pressed={pinned.has(id)}
                onPress={onPin && (() => onPin(id))}
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
                    {onPin ? (
                      <p className="text-xs text-muted">
                        {t(
                          pinned.has(id)
                            ? "heat-map.rotation.unpin-hint"
                            : "heat-map.rotation.pin-hint"
                        )}
                      </p>
                    ) : null}
                  </>
                }
                className={cn(
                  "inset-auto -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface transition-[opacity,width,height]",
                  lifted(id) ? "size-3.5" : "size-2.5",
                  anyLifted && !lifted(id) && "opacity-30"
                )}
                style={{
                  left: cssPercent(x(last.level) / 100),
                  top: cssPercent(y(last.momentum) / 100),
                  backgroundColor: color,
                }}
              />
              {lifted(id) ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -translate-y-1/2 rounded-sm bg-surface/80 px-1 text-[11px] leading-4 font-medium whitespace-nowrap",
                    // Named on the side away from the nearer edge.
                    x(last.level) > 70
                      ? "-translate-x-[calc(100%+0.625rem)]"
                      : "translate-x-2.5"
                  )}
                  style={{
                    left: cssPercent(x(last.level) / 100),
                    top: cssPercent(y(last.momentum) / 100),
                  }}>
                  {name}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The entries in each quadrant, the highest level first, in their group's colour: a listing's row
 * opens its page, and any other row pins its entry.
 */
function QuadrantLists({
  placed,
  focused,
  onFocus,
  pinned,
  onPin,
}: {
  placed: readonly PlacedEntry[];
  focused: string | null;
  onFocus: (id: string | null) => void;
  pinned: ReadonlySet<string>;
  onPin: (id: string) => void;
}) {
  const { t } = useTranslation();
  const lifted = (id: string) => focused === id || pinned.has(id);
  const anyLifted = focused !== null || pinned.size > 0;

  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs @md/main:grid-cols-4">
      {QUADRANT_ORDER.map((quadrant) => {
        const inside = orderBy(
          placed.filter(({ reading }) => reading.quadrant === quadrant),
          [({ reading }) => reading.trail.at(-1)?.level ?? 0],
          ["desc"]
        );

        return (
          <li key={quadrant} className="flex flex-col gap-1">
            <p className="flex items-baseline gap-1.5 font-medium">
              {t(`heat-map.rotation.quadrants.${quadrant}`)}
              <span className="font-normal text-muted tabular-nums">
                {inside.length}
              </span>
            </p>
            <ol className="flex flex-col gap-0.5">
              {inside.map(({ id, name, title, color, symbol }) => {
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
                  "flex min-w-0 items-center gap-1.5 text-left transition-colors",
                  lifted(id) ? "text-foreground" : "text-muted",
                  pinned.has(id) && "font-medium",
                  anyLifted && !lifted(id) && "opacity-50"
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
                      <button
                        type="button"
                        aria-pressed={pinned.has(id)}
                        onClick={() => onPin(id)}
                        className={cn(
                          className,
                          "w-full cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        )}>
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </li>
        );
      })}
    </ul>
  );
}

/** That the older bars are still read, while they are. */
function FillingIn({
  playback,
  loading,
}: {
  playback: RotationPlayback;
  loading: boolean;
}) {
  const { t } = useTranslation();

  if (!loading || playback.complete) return null;

  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-muted">
      <Spinner size="sm" color="current" />
      {t("heat-map.rotation.older")}
    </p>
  );
}

/** Why no entry has a reading, unless the older bars that would give one are still read. */
function NoReadings({
  playback,
  loading,
}: {
  playback: RotationPlayback;
  loading: boolean;
}) {
  const { t } = useTranslation();

  if (loading && !playback.complete) return null;

  return <p className="text-sm text-muted">{t("heat-map.rotation.none")}</p>;
}

/**
 * Entries on a relative rotation graph over a period picked here, in their group's colour, each
 * group shown or hidden by its own toggle where there are several; under the plot, the timeline
 * it may be taken back along and the entries by quadrant. Taking it back reads the paths it
 * holds, and the axes reach as far as any session shown would, so the plot keeps still while the
 * dots move. Entries pinned on the plot or in the lists stay lifted across sessions and periods.
 */
export function RotationGraph({
  entries,
  groups,
  playback,
  controls,
  loading = false,
}: {
  entries: readonly RotationEntry[];
  groups: readonly RotationGroup[];
  playback: RotationPlayback;
  /** More controls beside the bars and period, such as the benchmark. */
  controls?: ReactNode;
  /** The entries are the last read while another is on its way; while they are incomplete, what comes next only fills them in. */
  loading?: boolean;
}) {
  const { t } = useTranslation();

  const [interval, setInterval] = useState<RotationInterval>(
    RotationInterval.Daily
  );

  const [period, setPeriod] = useState(DEFAULT_PERIOD[interval]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NONE);
  const [focused, setFocused] = useState<string | null>(null);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(NONE);
  const [through, setThrough] = useState<string | null>(null);

  const pin = (id: string) =>
    setPinned((before) => {
      const after = new Set(before);

      if (!after.delete(id)) after.add(id);

      return after;
    });

  const colors = new Map(groups.map((each) => [each.id, each.color]));

  const shown = entries.flatMap(({ paths, ...entry }) => {
    const path = paths.find(
      (each) => each.interval === interval && each.period === period
    );

    const color = colors.get(entry.group);

    return path && color !== undefined && !hidden.has(entry.group)
      ? [{ ...entry, color, path }]
      : [];
  });

  const placed = shown.flatMap(({ path, ...entry }): PlacedEntry[] => {
    const reading = readingThrough(path, through ?? undefined);

    return reading.quadrant ? [{ ...entry, reading }] : [];
  });

  const stops = shown.flatMap(({ path }) => path.stops);
  const first = playback.sessions.at(0);

  const frames = uniq(
    stops
      .map(({ date }) => date)
      .filter((date) => first === undefined || date >= first)
  ).toSorted();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <OptionSelect
          label={t("heat-map.rotation.bars")}
          value={interval}
          options={Object.values(RotationInterval).map((each) => ({
            id: each,
            label: t(`heat-map.rotation.intervals.${each}`),
          }))}
          onChange={(next) => {
            if (isEnumValue(RotationInterval, next)) {
              setInterval(next);
              setPeriod(DEFAULT_PERIOD[next]);
            }
          }}
          className="w-36"
        />
        <OptionSelect
          label={t("heat-map.rotation.period")}
          value={String(period)}
          options={ROTATION_PERIODS[interval].map((each) => ({
            id: String(each),
            label: t(`heat-map.rotation.periods.${interval}`, { count: each }),
          }))}
          onChange={(id) => setPeriod(Number(id))}
          className="w-44"
        />
        {controls}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {groups.length > 1 ? (
          <ToggleButtonGroup
            aria-label={t("heat-map.rotation.group")}
            selectionMode="multiple"
            disallowEmptySelection
            size="sm"
            selectedKeys={groups
              .filter(({ id }) => !hidden.has(id))
              .map(({ id }) => id)}
            onSelectionChange={(keys) =>
              setHidden(
                new Set(
                  groups.filter(({ id }) => !keys.has(id)).map(({ id }) => id)
                )
              )
            }>
            {groups.map(({ id, label, color }, index) => (
              <ToggleButton
                key={id}
                id={id}
                className="not-data-selected:text-muted not-data-selected:[&_i]:opacity-40">
                {index > 0 ? <ToggleButtonGroup.Separator /> : null}
                <i
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        ) : null}
        <FillingIn playback={playback} loading={loading} />
        {pinned.size > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onPress={() => setPinned(NONE)}>
            {t("heat-map.rotation.clear-pins", { count: pinned.size })}
          </Button>
        ) : null}
      </div>
      {placed.length === 0 ? (
        <NoReadings playback={playback} loading={loading} />
      ) : (
        <>
          <RotationPlot
            placed={placed}
            focused={focused}
            onFocus={setFocused}
            pinned={pinned}
            onPin={pin}
            loading={loading && playback.complete}
            reach={reachOf(stops)}
          />
          {frames.length > 1 ? (
            <RotationTimeline
              frames={frames}
              closes={
                playback.closes &&
                closesOn(playback.sessions, playback.closes, frames)
              }
              interval={interval}
              through={through}
              onChange={setThrough}
            />
          ) : null}
          <QuadrantLists
            placed={placed}
            focused={focused}
            onFocus={setFocused}
            pinned={pinned}
            onPin={pin}
          />
        </>
      )}
    </div>
  );
}
