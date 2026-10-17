import type { Sun } from "./horizon.tsx";

export interface StillHorizonProps {
  width: number;
  height: number;
  horizon: number;
  sun: Sun;
}

/** The emblem drawn in SVG, for browsers that cannot run the canvas. */
export function StillHorizon({
  width,
  height,
  horizon,
  sun,
}: StillHorizonProps) {
  if (width === 0) return null;

  const left = sun.x - sun.radius;
  const right = sun.x + sun.radius;
  const arc = `M${left} ${horizon}A${sun.radius} ${sun.radius} 0 0 1 ${right} ${horizon}`;
  const below = `M${left} ${horizon}A${sun.radius} ${sun.radius} 0 0 0 ${right} ${horizon}`;

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <pattern
          id="still-hatch"
          width="11"
          height="11"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="11"
            stroke="var(--graphite)"
            strokeWidth="1.5"
          />
        </pattern>
      </defs>
      <path d={`${arc}Z`} fill="var(--primary)" />
      <path d={`${below}Z`} fill="var(--card)" />
      <path d={`${below}Z`} fill="url(#still-hatch)" />
      <path
        d={below}
        fill="none"
        stroke="var(--graphite)"
        strokeWidth="2"
        strokeDasharray="14 9"
      />
    </svg>
  );
}
