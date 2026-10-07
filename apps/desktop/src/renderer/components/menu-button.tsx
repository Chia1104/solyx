import type { ReactNode } from "react";

import { Button, cn } from "@heroui/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { Icon } from "./icon.tsx";

/** The button that opens a toolbar's menu, its chevron turned while the menu is open. */
export function MenuButton({
  className,
  "aria-label": ariaLabel,
  children,
}: {
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant="tertiary"
      aria-label={ariaLabel}
      className={cn("group shrink-0 gap-1.5", className)}>
      {children}
      <Icon
        icon={ArrowDown01Icon}
        className="size-3.5 text-muted transition-transform ease-out-quint group-aria-expanded:rotate-180 motion-reduce:transition-none"
      />
    </Button>
  );
}
