import type { ReactNode } from "react";

import { cn } from "@heroui/react";

import { ColumnHeader } from "./column-header.tsx";

/**
 * Keeps reading content at a comfortable width in the middle of the main view. Once the view
 * is wider than the column it gains hairline rails, so rules that run the full width look
 * drawn across one sheet; narrower, it fills the view and leaves the pane borders alone.
 */
export const RAILED_COLUMN =
  "mx-auto w-full max-w-3xl border-separator @min-[50rem]/main:border-x";

export function RailedColumn({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <div className={cn(RAILED_COLUMN, className)}>{children}</div>;
}

/** A titled page of ruled sections inside a railed column that runs to the bottom of the view. */
export function Sheet({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <ColumnHeader className="px-0">
        <RailedColumn className="flex h-full items-center px-6">
          <h1 className="text-sm font-semibold">{title}</h1>
        </RailedColumn>
      </ColumnHeader>
      {children}
      <RailedColumn className="flex-1" />
    </div>
  );
}
