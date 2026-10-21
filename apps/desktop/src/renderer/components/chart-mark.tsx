import type { CSSProperties, ReactNode } from "react";

import { Tooltip, cn } from "@heroui/react";
import { Focusable } from "react-aria-components";

const TOOLTIP_DELAY = 150;

/**
 * One mark of a chart, such as a column or a dot: an image named `label` that names itself again
 * in a tooltip, or says `tooltip` where given, as the pointer rests on it or focus reaches it, as
 * the heat map's tiles do. It fills its positioned box unless `className` places it, and shades
 * that box while it is pointed at, so a column's band lights up behind it.
 */
export function ChartMark({
  label,
  tooltip,
  className,
  style,
  children,
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Focusable>
        <span
          role="img"
          aria-label={label}
          className={cn(
            "group/mark absolute inset-0 rounded-[3px] outline-none hover:bg-default focus-visible:bg-default focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
            className
          )}
          style={style}>
          {children}
        </span>
      </Focusable>
      <Tooltip.Content className="flex flex-col gap-1 tabular-nums">
        {tooltip ?? label}
      </Tooltip.Content>
    </Tooltip>
  );
}
