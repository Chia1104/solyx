import { useId } from "react";

import { cn } from "@heroui/react";
import { clamp } from "es-toolkit";

interface SparklinePoint {
  time: number;
  value: number;
}

// Room above and below the line, in hundredths of the box.
const INSET = 8;

/**
 * Values across a span of time, scaled to fill its box, over a dashed baseline and a wash of
 * the line's colour that fades toward the bottom. A span that is still running leaves the rest
 * of the box empty, so the line's length shows how far in it is.
 */
export function Sparkline({
  points,
  from,
  to,
  baseline,
  color,
  className,
}: {
  points: readonly SparklinePoint[];
  /** The span the box covers, in the points' time unit. */
  from: number;
  to: number;
  baseline: number | null;
  /** Any CSS colour, custom properties included. */
  color: string;
  className?: string;
}) {
  const fade = useId();
  const values = points.map((point) => point.value);

  if (baseline !== null) values.push(baseline);

  const low = Math.min(...values);
  const high = Math.max(...values);

  const x = (time: number) =>
    ((clamp(time, from, to) - from) / (to - from || 1)) * 100;

  // A flat line sits in the middle.
  const y = (value: number) =>
    high === low
      ? 50
      : INSET + ((high - value) / (high - low)) * (100 - 2 * INSET);

  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`
    )
    .join("");

  const first = points.at(0);
  const last = points.at(-1);

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}>
      <defs>
        <linearGradient
          id={fade}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={0}
          x2={0}
          y2={100}>
          <stop offset={0} style={{ stopColor: color, stopOpacity: 0.24 }} />
          <stop offset={1} style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {first && last ? (
        <path
          d={`${path}L${x(last.time).toFixed(2)},100L${x(first.time).toFixed(2)},100Z`}
          fill={`url(#${fade})`}
        />
      ) : null}
      {baseline === null ? null : (
        <line
          x1={0}
          x2={100}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
          className="text-muted/60"
        />
      )}
      <path
        d={path}
        fill="none"
        style={{ stroke: color }}
        strokeWidth={1.25}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
