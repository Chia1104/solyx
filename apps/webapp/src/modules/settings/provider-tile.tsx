import type { ReactNode } from "react";

import { cn } from "@heroui/react";
import { Tab } from "react-aria-components";

export const TileTone = {
  /** Switched off. */
  Quiet: "quiet",
  /** In use but unable to run, for want of a key or the like. */
  Pencil: "pencil",
  /** Able to run. */
  Ink: "ink",
} as const;

export type TileTone = (typeof TileTone)[keyof typeof TileTone];

const TONES: Record<TileTone, string> = {
  [TileTone.Quiet]: "border border-separator text-muted",
  [TileTone.Pencil]: "pencil",
  [TileTone.Ink]: "border border-border bg-surface",
};

/**
 * A provider's tile in a grid of tabs, which opens the provider's settings below the grid. It is
 * named for the provider, then says what state it is in.
 */
export function ProviderTile({
  id,
  mark,
  name,
  state,
  tone,
  badge,
}: {
  id: string;
  mark: ReactNode;
  name: string;
  state: string;
  tone: TileTone;
  /** What sets this provider apart from the others, such as being the default. */
  badge?: string;
}) {
  return (
    <Tab
      id={id}
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-3 rounded p-3 ring-offset-2 ring-offset-background outline-none",
        TONES[tone],
        "data-focus-visible:ring-2 data-focus-visible:ring-focus not-data-selected:data-hovered:border-muted data-selected:ring-2 data-selected:not-data-focus-visible:ring-foreground"
      )}>
      {mark}
      <span className="col-span-2 flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted">{state}</span>
      </span>
      {/* Placed beside the mark but last in order, so the tab is named for its provider first. */}
      {badge ? (
        <span className="col-start-2 row-start-1 text-xs text-accent">
          {badge}
        </span>
      ) : null}
    </Tab>
  );
}

/** The grid the tiles sit in; HeroUI's Tabs draw a segmented control, so it composes react-aria's. */
export const PROVIDER_GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3";

export const PROVIDER_PANEL =
  "outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus";
