import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** Whether the element is on screen, so a loop can stop while nobody sees it. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? false)
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return inView;
}

/** Whether the visitor asked for less motion; loops then hold their last frame. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
