import { useSyncExternalStore } from "react";

import { noop } from "es-toolkit";

import { Platform } from "./releases.ts";

const unchanging = () => noop;

function visitorPlatform(): Platform | null {
  const { userAgent, maxTouchPoints } = navigator;

  if (userAgent.includes("Windows")) return Platform.Windows;

  // iPadOS asks for desktop sites as a Mac, but has a touch screen.
  if (userAgent.includes("Macintosh") && maxTouchPoints < 2) {
    return Platform.MacOS;
  }

  return null;
}

/**
 * The desktop system the visitor's browser runs on, `null` on any other. It is `undefined` until
 * the page hydrates, so the prerendered page is the same for everyone.
 */
export function useVisitorPlatform(): Platform | null | undefined {
  return useSyncExternalStore(unchanging, visitorPlatform, () => undefined);
}
