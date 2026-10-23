import type { ErrorEvent } from "@sentry/electron/main";

/** The app's lifecycle and its processes ending; other breadcrumbs record what the person did or typed. */
const KEPT_BREADCRUMBS = new Set(["electron", "child-process"]);

/**
 * Takes out of a report what tells about the person rather than the code: breadcrumbs beyond the
 * app's lifecycle, the renderer's address, which names the listing on screen, the arguments of the
 * callback that threw, and the home folder in messages, which holds their user name. The main
 * process runs every report through it, the renderer's included.
 */
export function scrubEvent(event: ErrorEvent, home: string): ErrorEvent {
  const hideHome = (text: string | undefined) => text?.replaceAll(home, "~");

  return {
    ...event,
    message: hideHome(event.message),
    request: undefined,
    user: undefined,
    extra: undefined,
    breadcrumbs: event.breadcrumbs?.filter(
      ({ category }) => category !== undefined && KEPT_BREADCRUMBS.has(category)
    ),
    exception: event.exception && {
      ...event.exception,
      values: event.exception.values?.map((exception) => ({
        ...exception,
        value: hideHome(exception.value),
      })),
    },
  };
}
