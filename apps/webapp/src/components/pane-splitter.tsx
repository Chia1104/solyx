import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { cn } from "@heroui/react";
import { clamp } from "es-toolkit";

const KEYBOARD_STEP = 16;

/** Set on `<html>` to the splitter's orientation while a pane is dragged, so transitions pause and the cursor holds. */
const PANE_RESIZING_ATTRIBUTE = "data-pane-resizing";

export const SplitterEdge = {
  /** The pane sits at the start (left or top), so the splitter is on its end edge. */
  Start: "start",
  End: "end",
} as const;

export type SplitterEdge = (typeof SplitterEdge)[keyof typeof SplitterEdge];

/** The way the splitter's line runs: vertical between columns, horizontal between rows. */
export const SplitterOrientation = {
  Vertical: "vertical",
  Horizontal: "horizontal",
} as const;

export type SplitterOrientation =
  (typeof SplitterOrientation)[keyof typeof SplitterOrientation];

const KEYS: Record<SplitterOrientation, { back: string; forward: string }> = {
  [SplitterOrientation.Vertical]: { back: "ArrowLeft", forward: "ArrowRight" },
  [SplitterOrientation.Horizontal]: { back: "ArrowUp", forward: "ArrowDown" },
};

/**
 * The hairline between a pane and the view beside it, dragged or moved with the arrow keys.
 * A drag previews sizes without rendering and commits once on release.
 */
export function PaneSplitter({
  orientation = SplitterOrientation.Vertical,
  edge,
  label,
  controls,
  size,
  min,
  maxSize,
  onPreview,
  onCommit,
  onReset,
}: {
  /** @default SplitterOrientation.Vertical */
  orientation?: SplitterOrientation;
  edge: SplitterEdge;
  label: string;
  /** The id of the pane it resizes. */
  controls: string;
  /** The pane's width, or its height when the splitter is horizontal. */
  size: number;
  min: number;
  /** Read when a resize starts, since the room left depends on the window and the other panes. */
  maxSize: () => number;
  onPreview: (size: number) => void;
  onCommit: (size: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{
    start: number;
    startSize: number;
    max: number;
    size: number;
  } | null>(null);

  const vertical = orientation === SplitterOrientation.Vertical;

  // Moving toward the view beside it grows the pane on either side.
  const direction = edge === SplitterEdge.Start ? 1 : -1;

  const pointer = (event: PointerEvent) =>
    vertical ? event.clientX : event.clientY;

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;

    if (!current) return;

    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.documentElement.removeAttribute(PANE_RESIZING_ATTRIBUTE);
    onCommit(current.size);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const max = maxSize();
    const { back, forward } = KEYS[orientation];

    const next = {
      [back]: size - KEYBOARD_STEP * direction,
      [forward]: size + KEYBOARD_STEP * direction,
      Home: min,
      End: max,
    }[event.key];

    if (next === undefined) return;

    event.preventDefault();
    onCommit(clamp(next, min, max));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={maxSize()}
      aria-valuenow={size}
      className={cn(
        "group absolute z-20 flex touch-none outline-none",
        vertical
          ? "inset-y-0 w-2 cursor-col-resize justify-center"
          : "inset-x-0 h-2 cursor-row-resize items-center",
        vertical && (edge === SplitterEdge.Start ? "-right-1" : "-left-1"),
        !vertical && (edge === SplitterEdge.Start ? "-bottom-1" : "-top-1")
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.setAttribute(
          PANE_RESIZING_ATTRIBUTE,
          orientation
        );
        drag.current = {
          start: pointer(event),
          startSize: size,
          max: maxSize(),
          size,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;

        if (!current) return;

        current.size = Math.round(
          clamp(
            current.startSize + (pointer(event) - current.start) * direction,
            min,
            current.max
          )
        );
        onPreview(current.size);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}>
      <div
        className={cn(
          "transition-colors group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent",
          vertical ? "h-full w-0.5" : "h-0.5 w-full"
        )}
      />
    </div>
  );
}
