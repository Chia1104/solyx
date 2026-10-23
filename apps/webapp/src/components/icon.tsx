import { cn } from "@heroui/react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

/**
 * A Hugeicons icon at the size and weight the app draws its controls in. It is decoration: the
 * control it sits in carries the label.
 */
export function Icon({
  icon,
  className,
}: {
  icon: IconSvgElement;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      aria-hidden
      strokeWidth={1.5}
      className={cn("size-4", className)}
    />
  );
}
