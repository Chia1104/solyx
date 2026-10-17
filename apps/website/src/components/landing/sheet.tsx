import type { ComponentProps, ReactNode } from "react";

import { cn } from "cn";

/** The drafting sheet's margin: a dashed rail down each side of the page's column. */
export function Sheet({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border-graphite/45 mx-3 border-x border-dashed sm:mx-6 lg:mx-auto lg:max-w-6xl",
        className
      )}
      {...props}
    />
  );
}

export interface SheetRowProps extends ComponentProps<"div"> {
  /** Whether a rule with registration marks on both rails parts this row from the one above. */
  ruled?: boolean;
}

/** One band of the sheet. */
export function SheetRow({ ruled = true, className, ...props }: SheetRowProps) {
  return (
    <div
      className={cn(
        "relative",
        ruled &&
          "before:border-graphite/60 after:border-graphite/60 border-t border-border before:absolute before:-top-[3px] before:-left-1 before:z-10 before:size-[7px] before:border before:bg-background after:absolute after:-top-[3px] after:-right-1 after:z-10 after:size-[7px] after:border after:bg-background",
        className
      )}
      {...props}
    />
  );
}

export interface SheetHeadProps {
  id: string;
  title: ReactNode;
  children: ReactNode;
}

/** A section's centred title and lede. */
export function SheetHead({ id, title, children }: SheetHeadProps) {
  return (
    <div className="px-6 pt-20 pb-12 text-center md:pt-24 md:pb-14">
      <h2
        id={id}
        className="text-[clamp(2rem,4.4vw,3rem)] leading-[1.04] font-[470] tracking-[-0.025em] text-balance [font-stretch:108%]">
        {title}
      </h2>
      <p className="text-muted-foreground mx-auto mt-4 max-w-[34em] text-lg leading-relaxed text-pretty">
        {children}
      </p>
    </div>
  );
}
