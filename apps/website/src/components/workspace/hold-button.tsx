import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "cn";

import { buttonVariants } from "../ui/button.tsx";

/** As long as the app's own hold takes to act. */
const HOLD_MS = 1200;

/** Space and Enter press a button; either held holds it. */
const PRESS_KEYS = new Set([" ", "Enter"]);

/**
 * The app's hold to submit: ink floods it from its start edge while it is held and it acts once
 * full; let go sooner, the ink drains back. Only letting go ends a hold, wherever it happens. A
 * press with neither a pointer nor a key behind it, as a screen reader's, acts at once.
 */
export function HoldButton({
  onConfirm,
  children,
}: {
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listening = useRef<AbortController | null>(null);

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

  const hold = (end: "pointerup" | "keyup") => {
    if (listening.current) return;

    setHeld(true);
    timer.current = setTimeout(onConfirm, HOLD_MS);
    listening.current = new AbortController();

    for (const type of [end, "pointercancel", "blur"]) {
      window.addEventListener(type, release, {
        signal: listening.current.signal,
      });
    }
  };

  return (
    <button
      type="button"
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "relative overflow-hidden"
      )}
      onPointerDown={(event) => {
        if (event.button === 0) hold("pointerup");
      }}
      // A key's own click would act at once, so the hold takes the key instead.
      onKeyDown={(event) => {
        if (!PRESS_KEYS.has(event.key)) return;

        event.preventDefault();

        if (!event.repeat) hold("keyup");
      }}
      onKeyUp={(event) => {
        if (PRESS_KEYS.has(event.key)) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.detail === 0 && !listening.current) onConfirm();
      }}>
      {children}
      <span
        aria-hidden
        data-held={held || undefined}
        style={held ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
        className="bg-primary text-primary-foreground absolute inset-0 flex items-center justify-center rounded-[inherit] transition-[clip-path] duration-200 ease-out [clip-path:inset(0_100%_0_0)] data-held:ease-linear data-held:[clip-path:inset(0)] motion-reduce:opacity-0 motion-reduce:transition-opacity motion-reduce:[clip-path:none] motion-reduce:data-held:opacity-100">
        {children}
      </span>
    </button>
  );
}
