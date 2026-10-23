import type { ReactNode } from "react";

import { cn } from "@heroui/react";

/**
 * The mark leading a row the agent works through: a tool call, its thinking, the run still going.
 * Every such row starts with one, so their labels line up and the thinking's rule hangs below it.
 */
export function ActivityMark({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn("grid size-3.5 shrink-0 place-items-center", className)}>
      {children}
    </span>
  );
}
