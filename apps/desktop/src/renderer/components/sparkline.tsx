import { useId } from "react";

import { cn } from "@heroui/react";
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";

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

  const x = scaleLinear().domain([from, to]).range([0, 100]).clamp(true);

  // A flat line sits in the middle, where d3 puts every value of a domain with no width.
  const y = scaleLinear()
    .domain([Math.min(...values), Math.max(...values)])
    .range([100 - INSET, INSET]);

  const path = line<SparklinePoint>(
    (point) => x(point.time),
    (point) => y(point.value)
  )(points);

  const wash = area<SparklinePoint>(
    (point) => x(point.time),
    100,
    (point) => y(point.value)
  )(points);

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
      {wash ? <path d={wash} fill={`url(#${fade})`} /> : null}
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
        d={path ?? undefined}
        fill="none"
        style={{ stroke: color }}
        strokeWidth={1.25}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
