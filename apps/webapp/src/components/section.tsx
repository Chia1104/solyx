import { useId } from "react";
import type { ReactNode } from "react";

/** A titled sheet of a page, with what it is for under the title where it says. */
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
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 sheet p-4">
      <header className="flex max-w-prose flex-col gap-1">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {description ? (
          <div className="text-sm text-muted">{description}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}
