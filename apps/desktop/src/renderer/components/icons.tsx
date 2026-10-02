import type { ReactNode } from "react";

import { cn } from "@heroui/react";

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

function StrokeIcon({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn("size-4", className)}
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

export function CheckIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M3.5 8.5l3 3 6-7" />
    </StrokeIcon>
  );
}

export function CrossIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </StrokeIcon>
  );
}

export function DashIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.5 8h7" />
    </StrokeIcon>
  );
}

export function ClockIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.5V8l1.75 1.25" />
    </StrokeIcon>
  );
}

export function CopyIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </StrokeIcon>
  );
}

export function TrashIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M2.5 4.5h11M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4 4.5l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L12 4.5" />
    </StrokeIcon>
  );
}

export function PencilIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M10.25 2.75l3 3-7.5 7.5h-3v-3zM8.75 4.25l3 3" />
    </StrokeIcon>
  );
}

/** Two candles, for a listing. */
export function CandlesIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 2.5V5M5 10v3.5M11 3.5V6M11 10v2.5" />
      <rect x="3.5" y="5" width="3" height="5" rx="0.5" />
      <rect x="9.5" y="6" width="3" height="4" rx="0.5" />
    </StrokeIcon>
  );
}

export function SunIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
    </StrokeIcon>
  );
}

export function MoonIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M13.25 9.75A5.5 5.5 0 1 1 6.25 2.75a4.5 4.5 0 0 0 7 7z" />
    </StrokeIcon>
  );
}
