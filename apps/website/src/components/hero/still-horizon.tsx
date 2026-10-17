import { DOT_PITCH, HALO_REACH } from "./sun.ts";

export interface StillHorizonProps {
  width: number;
  height: number;
  /** The sun's radius in pixels. */
  sun: number;
}

/** The risen sun and its halo drawn in SVG, for browsers that cannot run the canvas. */
export function StillHorizon({ width, height, sun }: StillHorizonProps) {
  if (width === 0 || sun === 0) return null;

  const left = width / 2 - sun;
  const right = width / 2 + sun;

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <pattern
          id="still-dots"
          width={DOT_PITCH}
          height={DOT_PITCH}
          patternUnits="userSpaceOnUse">
          <circle
            cx={DOT_PITCH / 2}
            cy={DOT_PITCH / 2}
            r={DOT_PITCH / 4}
            fill="var(--primary)"
          />
        </pattern>
        <radialGradient
          id="still-fade"
          cx={width / 2}
          cy={height}
          r={sun * HALO_REACH}
          gradientUnits="userSpaceOnUse">
          <stop offset={1 / HALO_REACH} stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="still-halo">
          <rect width={width} height={height} fill="url(#still-fade)" />
        </mask>
      </defs>
      <rect
        width={width}
        height={height}
        fill="url(#still-dots)"
        mask="url(#still-halo)"
      />
      <path
        d={`M${left} ${height}A${sun} ${sun} 0 0 1 ${right} ${height}Z`}
        fill="var(--primary)"
      />
    </svg>
  );
}
