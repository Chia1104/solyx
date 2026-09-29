import type { ReactNode } from "react";

/** Centers a fallback in the region it stands in for, such as a page or a chart that failed. */
export function FallbackFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
