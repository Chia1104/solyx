import { cn } from "@heroui/react";

import { cssPercent } from "@solyx/utils/format";

/**
 * A figure's bar laid under its text: it hangs from its positioned box's left edge, or its right
 * with `fromRight`, as long as `share` of the box, and washes from clear there into `color` at the
 * end that marks the figure, so the text over its start stays legible.
 */
export function WashBar({
  share,
  color,
  fromRight = false,
  className,
}: {
  share: number;
  /** Any CSS colour, custom properties included. */
  color: string;
  fromRight?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inset-y-0 rounded-md",
        fromRight ? "right-0" : "left-0",
        className
      )}
      style={{
        width: cssPercent(share),
        backgroundImage: `linear-gradient(to ${fromRight ? "left" : "right"}, color-mix(in oklab, ${color} 2%, transparent), color-mix(in oklab, ${color} 34%, transparent))`,
      }}
    />
  );
}
