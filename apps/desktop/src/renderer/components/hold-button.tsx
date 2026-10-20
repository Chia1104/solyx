import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button, cn } from "@heroui/react";
import type { ButtonProps } from "@heroui/react";

/** How long a hold takes to act: long enough that no click or brush of a key does it. */
const HOLD_MS = 1200;

/**
 * A button pressed and held to act, for what sends something that cannot be taken back, such as
 * an order. Ink floods it from its start edge while held and drains back if it is let go before
 * it fills; it stays full while the act is pending. A screen reader's press acts at once, since it
 * cannot hold.
 */
export function HoldButton({
  size,
  isPending,
  isDisabled,
  className,
  onConfirm,
  children,
}: {
  size?: ButtonProps["size"];
  isPending?: boolean;
  isDisabled?: boolean;
  className?: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listening = useRef<AbortController | null>(null);
  // Read as the hold fills, so a button disabled meanwhile, as by the order lock, does not act.
  const latest = useRef({ onConfirm, isDisabled });

  useEffect(() => {
    latest.current = { onConfirm, isDisabled };
  });

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      listening.current?.abort();
    },
    []
  );

  const release = () => {
    clearTimeout(timer.current);
    listening.current?.abort();
    listening.current = null;
    setHeld(false);
  };

  const inked = held || isPending === true;

  return (
    <Button
      size={size}
      variant="secondary"
      isPending={isPending}
      isDisabled={isDisabled}
      className={cn("overflow-hidden", className)}
      onPressStart={({ pointerType }) => {
        if (pointerType === "virtual" || listening.current) return;

        setHeld(true);
        timer.current = setTimeout(() => {
          if (!latest.current.isDisabled) latest.current.onConfirm();
        }, HOLD_MS);

        // Only letting go ends a hold, wherever it happens: a line above may reflow and move the
        // button out from under a pointer that never moved.
        listening.current = new AbortController();

        for (const type of [
          pointerType === "keyboard" ? "keyup" : "pointerup",
          "pointercancel",
          "blur",
        ]) {
          window.addEventListener(type, release, {
            signal: listening.current.signal,
          });
        }
      }}
      onPress={({ pointerType }) => {
        if (pointerType === "virtual") onConfirm();
      }}>
      {children}
      {/* The same label in ink over the pencil one, revealed from the start edge as the hold goes on. */}
      <span
        aria-hidden
        data-inked={inked || undefined}
        // Fills at the hold's own pace and drains back at the transition's quicker one.
        style={inked ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
        className={cn(
          "absolute inset-0 flex items-center justify-center gap-2 rounded-[inherit] bg-accent text-accent-foreground",
          "transition-[clip-path] duration-200 ease-out-quint [clip-path:inset(0_100%_0_0)]",
          "data-inked:ease-linear data-inked:[clip-path:inset(0)]",
          "motion-reduce:opacity-0 motion-reduce:transition-opacity motion-reduce:[clip-path:none] motion-reduce:data-inked:opacity-100"
        )}>
        {children}
      </span>
    </Button>
  );
}
