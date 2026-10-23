import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button, cn } from "@heroui/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { Icon } from "./icon.tsx";

/**
 * Content held to `maxHeight` behind a fade, with a toggle to show it whole. Overflow is observed
 * rather than measured once, so content that grows past the height gains the toggle.
 */
export function Expandable({
  maxHeight,
  children,
  className,
  toggleClassName,
}: {
  /** In pixels. */
  maxHeight: number;
  children: ReactNode;
  className?: string;
  toggleClassName?: string;
}) {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = content.current;

    if (!element) return;

    const measure = () => setOverflows(element.scrollHeight > maxHeight);

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(element);

    return () => observer.disconnect();
  }, [maxHeight]);

  const clipped = overflows && !expanded;

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "overflow-hidden",
          clipped &&
            "[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]"
        )}
        style={{ maxHeight: expanded ? undefined : maxHeight }}>
        <div ref={content}>{children}</div>
      </div>
      {overflows ? (
        <div className={cn("flex", toggleClassName)}>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            className="h-6 gap-1 px-1.5 text-xs text-muted"
            onPress={() => setExpanded((open) => !open)}>
            {expanded ? t("common.show-less") : t("common.show-more")}
            <Icon
              icon={ArrowDown01Icon}
              className={cn(
                "size-3.5 transition-transform ease-out-quint motion-reduce:transition-none",
                expanded && "rotate-180"
              )}
            />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
