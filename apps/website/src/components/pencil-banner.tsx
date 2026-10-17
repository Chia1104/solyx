import type { ReactNode } from "react";

import { Banner } from "fumadocs-ui/components/banner";

/**
 * A notice across the top of the page, drawn in pencil since it marks what is not finished yet.
 * Closing it is remembered by its `id`.
 */
export function PencilBanner({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <Banner
      id={id}
      className="border-graphite/45 border-b border-dashed bg-background hatch px-12 font-normal text-foreground [--hatch-color:color-mix(in_oklab,var(--graphite)_16%,transparent)]">
      {children}
    </Banner>
  );
}
