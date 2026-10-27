import type { ReactNode } from "react";

import { cn } from "@heroui/react";

import { ColumnHeader } from "./column-header.tsx";

/** Keeps reading content at a comfortable width in the middle of the main view, its sheets a gap apart. */
export function PageColumn({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-3xl flex-col gap-2", className)}>
      {children}
    </div>
  );
}

/** A titled page: the title on the table and the sections under it, each on a sheet of its own. */
export function Page({
  title,
  header,
  children,
}: {
  title: string;
  /** What the title's row holds beside it, such as the page's tabs. */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageColumn>
      <ColumnHeader className="gap-4">
        <h1 className="shrink-0 text-sm font-semibold">{title}</h1>
        {header}
      </ColumnHeader>
      {children}
    </PageColumn>
  );
}
