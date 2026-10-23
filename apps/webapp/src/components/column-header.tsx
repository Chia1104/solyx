import type { ReactNode } from "react";

import { cn } from "@heroui/react";

/** The row every workspace column opens with, one height for all, so the rules under them line up. */
export function ColumnHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center gap-3 border-b border-separator px-4",
        className
      )}>
      {children}
    </header>
  );
}
