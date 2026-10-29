import type { ReactNode } from "react";

import { cn } from "@heroui/react";

/**
 * The row every column opens with, which together make the window's top row: it moves the
 * window, keeps clear of what lies over its ends (`--column-start`, `--column-end`) and carries
 * the band that says whether orders are paper or real.
 */
export function ColumnHeader({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className="shrink-0">
      <div className="h-11 ps-(--column-start) pe-(--column-end) transition-[padding] duration-200 ease-out-quint app-drag motion-reduce:transition-none [html[data-pane-at-once]_&]:transition-none">
        <div className={cn("flex h-full items-center gap-3 px-4", className)}>
          {children}
        </div>
      </div>
      <div aria-hidden className="broker-rule" />
    </header>
  );
}
