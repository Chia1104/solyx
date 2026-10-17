import type { ComponentProps } from "react";

/** The sun's lower half, below the horizon, drawn in pencil: hatching inside a dashed outline. */
export function PencilHalf(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 200 100" overflow="visible" aria-hidden="true" {...props}>
      <defs>
        <pattern
          id="pencil-half-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="var(--graphite)"
            strokeOpacity="0.55"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <path d="M0 0A100 100 0 0 0 200 0Z" fill="url(#pencil-half-hatch)" />
      <path
        d="M0 0A100 100 0 0 0 200 0"
        fill="none"
        stroke="var(--graphite)"
        strokeWidth="2"
        strokeDasharray="13 9"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
