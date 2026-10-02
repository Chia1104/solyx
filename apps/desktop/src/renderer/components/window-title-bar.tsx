import type { ReactNode } from "react";

import { cn } from "@heroui/react";

/**
 * The window's own title bar: it moves the window and sits inside the room the OS leaves
 * beside its window controls.
 */
export function WindowTitleBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <header className="h-11 shrink-0 app-drag">
      <div
        className={cn(
          "ml-[env(titlebar-area-x,0px)] flex h-full w-[env(titlebar-area-width,100%)] items-center gap-3",
          className
        )}>
        {children}
      </div>
    </header>
  );
}
