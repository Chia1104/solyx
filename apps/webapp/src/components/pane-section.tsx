import { useId } from "react";
import type { ReactNode } from "react";

/** A titled run of a side pane's rows, with how many it holds where it says. */
export function PaneSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="pb-2">
      <h3
        id={titleId}
        className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs font-medium text-muted">
        {title}
        {count ? <span className="tabular-nums">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}
