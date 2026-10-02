import type { ReactNode } from "react";

import { SplitterEdge } from "./pane-splitter.tsx";

/** A window outline with the side pane at `edge` filled in while the pane is open. */
export function PaneIcon({
  edge,
  open,
}: {
  edge: SplitterEdge;
  open: boolean;
}) {
  const x = edge === SplitterEdge.Start ? 2 : 10;

  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d={edge === SplitterEdge.Start ? "M6 2.5v11" : "M10 2.5v11"} />
      {open ? (
        <rect
          x={x}
          y="3"
          width="4"
          height="10"
          fill="currentColor"
          stroke="none"
          opacity="0.35"
        />
      ) : null}
    </svg>
  );
}

function StrokeIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function GearIcon() {
  return (
    <StrokeIcon>
      <path d="M13.06 6.43 L14.8 6.83 L14.8 9.17 L13.06 9.57 L12.69 10.47 L13.63 11.98 L11.98 13.63 L10.47 12.69 L9.57 13.06 L9.17 14.8 L6.83 14.8 L6.43 13.06 L5.53 12.69 L4.02 13.63 L2.37 11.98 L3.31 10.47 L2.94 9.57 L1.2 9.17 L1.2 6.83 L2.94 6.43 L3.31 5.53 L2.37 4.02 L4.02 2.37 L5.53 3.31 L6.43 2.94 L6.83 1.2 L9.17 1.2 L9.57 2.94 L10.47 3.31 L11.98 2.37 L13.63 4.02 L12.69 5.53 Z" />
      <circle cx="8" cy="8" r="2.25" />
    </StrokeIcon>
  );
}

export function PlusIcon() {
  return (
    <StrokeIcon>
      <path d="M8 3v10M3 8h10" />
    </StrokeIcon>
  );
}

/** Stacked sheets, for earlier conversations. */
export function HistoryIcon() {
  return (
    <StrokeIcon>
      <rect x="2.5" y="4.5" width="11" height="9" rx="1.5" />
      <path d="M4.5 2.5h7" />
    </StrokeIcon>
  );
}

export function SendIcon() {
  return (
    <StrokeIcon>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </StrokeIcon>
  );
}

export function StopIcon() {
  return (
    <StrokeIcon>
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
    </StrokeIcon>
  );
}
