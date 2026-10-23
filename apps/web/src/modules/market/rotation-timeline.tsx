import { useEffect, useEffectEvent, useState } from "react";

import { Button, Slider } from "@heroui/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useTranslation } from "react-i18next";

import type { RotationInterval } from "@solyx/core/rotation";
import { cssPercent } from "@solyx/utils/format";

import { Icon } from "../../components/icon.tsx";

/** How long each bar shows while the graph plays. */
const FRAME_MS = 250;

// Room above and below the benchmark's line, in hundredths of the strip.
const INSET = 12;

/**
 * The bars the graph may be taken back to, as a strip along the benchmark's closes where one
 * governs every entry: dragging or clicking it takes the graph to that bar, the buttons step a
 * bar either way or play the bars on to the newest, and the line beyond the bar shown fades.
 */
export function RotationTimeline({
  frames,
  closes,
  interval,
  through,
  onChange,
}: {
  /** The days the graph changes on, oldest first: each session, or each week's last; the last is the newest. */
  frames: readonly string[];
  /** The benchmark's close on each of `frames`; `null` where entries name different benchmarks. */
  closes: readonly (number | null)[] | null;
  interval: RotationInterval;
  /** The day shown; `null` for the newest. */
  through: string | null;
  onChange: (through: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const last = frames.length - 1;

  const index =
    through === null
      ? last
      : Math.max(
          frames.findLastIndex((date) => date <= through),
          0
        );

  const go = (next: number) =>
    onChange(next >= last ? null : frames[Math.max(next, 0)]);

  const step = (by: number) => {
    setPlaying(false);
    go(index + by);
  };

  // Read at each tick, so nothing else that renders the graph meanwhile restarts the clock.
  const advance = useEffectEvent(() => {
    if (index >= last) {
      setPlaying(false);
    } else {
      go(index + 1);
    }
  });

  useEffect(() => {
    if (!playing) return;

    const timer = setInterval(advance, FRAME_MS);

    return () => clearInterval(timer);
  }, [playing]);

  const x = scaleLinear().domain([0, last]).range([0, 100]);
  const known = (closes ?? []).filter((close) => close !== null);

  const y = scaleLinear()
    .domain([Math.min(...known), Math.max(...known)])
    .range([100 - INSET, INSET]);

  const path = (from: number, to: number) =>
    line<number | null>()
      .defined((close) => close !== null)
      .x((_, i) => x(from + i))
      .y((close) => y(close ?? 0))(closes?.slice(from, to + 1) ?? []) ??
    undefined;

  const month = new Intl.DateTimeFormat(i18n.language, {
    month: "short",
    timeZone: "UTC",
  });

  // Each month is named at its first bar, after the first bar of all.
  const months = frames.flatMap((date, i) =>
    i > 0 && date.slice(0, 7) !== frames[i - 1].slice(0, 7)
      ? [{ i, name: month.format(new Date(`${date}T00:00:00Z`)) }]
      : []
  );

  return (
    <Slider
      aria-label={t("heat-map.rotation.playback")}
      minValue={0}
      maxValue={last}
      step={1}
      value={index}
      onChange={(value) => {
        setPlaying(false);
        go(Array.isArray(value) ? value[0] : value);
      }}
      className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t(
            playing ? "heat-map.rotation.pause" : "heat-map.rotation.play"
          )}
          onPress={() => {
            if (!playing && index >= last) go(0);

            setPlaying(!playing);
          }}>
          <Icon icon={playing ? PauseIcon : PlayIcon} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t(`heat-map.rotation.previous.${interval}`)}
          isDisabled={index <= 0}
          onPress={() => step(-1)}>
          <Icon icon={ArrowLeft01Icon} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t(`heat-map.rotation.next.${interval}`)}
          isDisabled={index >= last}
          onPress={() => step(1)}>
          <Icon icon={ArrowRight01Icon} />
        </Button>
        <Slider.Output
          aria-live={playing ? "off" : "polite"}
          className="ml-1 text-xs font-normal tabular-nums">
          {through === null
            ? t("heat-map.rotation.latest", { date: frames[last] })
            : frames[index]}
        </Slider.Output>
        {through === null ? null : (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onPress={() => {
              setPlaying(false);
              onChange(null);
            }}>
            {t("heat-map.rotation.to-latest")}
          </Button>
        )}
      </div>
      <Slider.Track className="h-10 cursor-pointer rounded-sm border-x-0 bg-transparent">
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible">
          {known.length > 0 ? (
            <>
              <path
                d={path(index, last)}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="text-muted/40"
              />
              <path
                d={path(0, index)}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="text-foreground/70"
              />
            </>
          ) : (
            <line
              x1={0}
              y1={50}
              x2={100}
              y2={50}
              stroke="currentColor"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              className="text-muted/60"
            />
          )}
        </svg>
        <Slider.Thumb className="h-full w-3 cursor-ew-resize rounded-none bg-transparent after:h-full after:w-0.5 after:rounded-none after:bg-foreground after:shadow-none" />
      </Slider.Track>
      <div aria-hidden className="relative h-3 text-[10px] text-muted">
        {months.map(({ i, name }) => (
          <span
            key={i}
            className="absolute top-0 -translate-x-1/2 leading-none"
            style={{ left: cssPercent(x(i) / 100) }}>
            {name}
          </span>
        ))}
      </div>
    </Slider>
  );
}
