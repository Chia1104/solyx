import { SITE_URL } from "./links.ts";

/** Where the build writes the social card for the page at `path`. */
export function socialCardPath(path: string) {
  return `/og${path === "/" ? "" : path}/image.png`;
}

/** The meta tag that shows crawlers the page's social card, which Open Graph wants absolute. */
export function socialCardMeta(path: string) {
  return {
    property: "og:image",
    content: new URL(socialCardPath(path), SITE_URL).href,
  };
}
