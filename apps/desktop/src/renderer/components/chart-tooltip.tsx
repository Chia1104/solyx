import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

/** The mark the pointer rests on, and where the pointer is in the window. */
interface ChartHover {
  index: number;
  x: number;
  y: number;
}

// Room between the pointer and the tooltip, and between the tooltip and the window's edges.
const GAP = 12;

/**
 * Which of a chart's marks the pointer rests on. A mark calls `show` as the pointer moves over it
 * and the plot calls `hide` as the pointer leaves, so crossing the gap between two marks keeps the
 * last one named rather than flickering.
 */
export function useChartHover() {
  const [hover, setHover] = useState<ChartHover | null>(null);

  return {
    hover,
    show: (index: number, event: PointerEvent) =>
      setHover({ index, x: event.clientX, y: event.clientY }),
    hide: () => setHover(null),
  };
}

/**
 * What a chart says of the mark under the pointer, drawn above the window beside the pointer and
 * flipped to the pointer's other side where the window's edge would cut it. It only repeats what
 * the chart's own text or the marks' descriptions say, so assistive technology skips it.
 */
export function ChartTooltip({
  hover,
  children,
}: {
  hover: ChartHover | null;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  // Placed before paint, once the content's size is known.
  useLayoutEffect(() => {
    const element = box.current;

    if (!element || !hover) return;

    const { offsetWidth: width, offsetHeight: height } = element;

    const left =
      hover.x + GAP + width > window.innerWidth - GAP
        ? hover.x - GAP - width
        : hover.x + GAP;

    const top =
      hover.y - GAP - height < GAP ? hover.y + GAP : hover.y - GAP - height;

    element.style.translate = `${Math.max(GAP, left)}px ${top}px`;
  });

  if (!hover) return null;

  return createPortal(
    <div
      ref={box}
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-50 flex max-w-xs flex-col gap-1 rounded-xl bg-overlay p-2 text-xs text-foreground tabular-nums shadow-(--overlay-shadow)">
      {children}
    </div>,
    document.body
  );
}
