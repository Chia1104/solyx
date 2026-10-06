/** HeroUI's `--ease-out-quint`, spelled out for the Web Animations API, which cannot read custom properties. */
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

const HIGHLIGHT_MS = 900;

/**
 * Fades a wash of `color` back to the element's own background to mark what just changed. It
 * moves nothing, so it plays under reduced motion too.
 */
export function highlight(element: Element | null | undefined, color: string) {
  element?.animate(
    [
      {
        backgroundColor: `color-mix(in oklab, ${color} 35%, transparent)`,
        offset: 0,
      },
    ],
    { duration: HIGHLIGHT_MS, easing: EASE_OUT }
  );
}
