import { useId } from "react";
import type { ReactNode } from "react";

import { RailedColumn } from "./sheet.tsx";

/** A ruled region of a sheet: no frame or fill, closed by a hairline that runs the full width. */
export function Section({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="border-b border-separator">
      <RailedColumn className="flex flex-col gap-4 px-6 py-5">
        <header className="flex max-w-prose flex-col gap-1">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <div className="text-sm text-muted">{description}</div>
          ) : null}
        </header>
        {children}
      </RailedColumn>
    </section>
  );
}
