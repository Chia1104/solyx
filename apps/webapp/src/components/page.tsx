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

/** A titled page: the title in the main view's header and the sections under it, each on a sheet of its own. */
export function Page({
  title,
  header,
  controls,
  children,
}: {
  title: string;
  /** What the title's row holds beside it, such as the page's tabs. */
  header?: ReactNode;
  /** What the title's row holds at its end, such as a filter over the whole page. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Inset a gap and a sheet's inset, so its text lines up with its sheets' while they fill the view. */}
      <ColumnHeader className="gap-4 px-6">
        {/* Beside controls the title gives way first on a narrow view; it still names the page to readers. */}
        <h1
          className={cn(
            "shrink-0 text-sm font-semibold",
            controls && "@max-[40rem]/main:sr-only"
          )}>
          {title}
        </h1>
        {header}
        {controls ? <div className="ml-auto shrink-0">{controls}</div> : null}
      </ColumnHeader>
      <div data-page-body className="min-h-0 flex-1 overflow-y-auto p-2">
        <PageColumn>{children}</PageColumn>
      </div>
    </div>
  );
}
