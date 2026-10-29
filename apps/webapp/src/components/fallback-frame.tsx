import type { ReactNode } from "react";

import { ColumnHeader } from "./column-header.tsx";

/** Centers a fallback in the region it stands in for, such as a page or a chart that failed. */
export function FallbackFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

/** Stands in for a whole page under a header of its own, which keeps the window's top row whole. */
export function PageFallback({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <ColumnHeader />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
