import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { cn } from "@heroui/react";
import { clamp } from "es-toolkit";

const KEYBOARD_STEP = 16;

/** Set on `<html>` while a pane is dragged, so width transitions pause and the cursor holds. */
export const PANE_RESIZING_ATTRIBUTE = "data-pane-resizing";

export const SplitterEdge = {
  /** The pane sits at the window's start, so the splitter is on its end edge. */
  Start: "start",
  End: "end",
} as const;

export type SplitterEdge = (typeof SplitterEdge)[keyof typeof SplitterEdge];

/**
 * The hairline between a side pane and the main view, dragged or moved with the arrow keys.
 * A drag previews widths without rendering and commits once on release.
 */
export function PaneSplitter({
  edge,
  label,
  controls,
  width,
  min,
  maxWidth,
  onPreview,
  onCommit,
  onReset,
}: {
  edge: SplitterEdge;
  label: string;
  /** The id of the pane it resizes. */
  controls: string;
  width: number;
  min: number;
  /** Read when a resize starts, since the room left depends on the window and the other pane. */
  maxWidth: () => number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{
    startX: number;
    startWidth: number;
    max: number;
    width: number;
  } | null>(null);

  // Moving toward the main view widens the pane on either side.
  const direction = edge === SplitterEdge.Start ? 1 : -1;

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;

    if (!current) return;

    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.documentElement.removeAttribute(PANE_RESIZING_ATTRIBUTE);
    onCommit(current.width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const max = maxWidth();

    const next = {
      ArrowLeft: width - KEYBOARD_STEP * direction,
      ArrowRight: width + KEYBOARD_STEP * direction,
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
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={maxWidth()}
      aria-valuenow={width}
      className={cn(
        "group absolute inset-y-0 z-20 flex w-2 cursor-col-resize touch-none justify-center outline-none",
        edge === SplitterEdge.Start ? "-right-1" : "-left-1"
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.setAttribute(PANE_RESIZING_ATTRIBUTE, "");
        drag.current = {
          startX: event.clientX,
          startWidth: width,
          max: maxWidth(),
          width,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;

        if (!current) return;

        current.width = Math.round(
          clamp(
            current.startWidth + (event.clientX - current.startX) * direction,
            min,
            current.max
          )
        );
        onPreview(current.width);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}>
      <div className="h-full w-0.5 transition-colors group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}
