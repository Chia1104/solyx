import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vite-plus/test";

import {
  followInboxChanges,
  inboxQueryKeys,
} from "../src/renderer/modules/inbox/inbox-query.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("what waits is read again on a push and as an exchange's day turns, and not otherwise", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T23:58:00+08:00"));

  const listeners: (() => void)[] = [];

  vi.stubGlobal("window", {
    solyx: {
      inbox: {
        onChanged: (listener: () => void) => {
          listeners.push(listener);

          return () => undefined;
        },
      },
    },
  });

  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  followInboxChanges(queryClient);

  vi.advanceTimersByTime(60 * 1000);
  expect(invalidate).not.toHaveBeenCalled();

  // Midnight in Taipei.
  vi.advanceTimersByTime(2 * 60 * 1000);
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({
    queryKey: inboxQueryKeys.all,
  });

  vi.advanceTimersByTime(10 * 60 * 1000);
  expect(invalidate).toHaveBeenCalledOnce();

  for (const listener of listeners) listener();
  expect(invalidate).toHaveBeenCalledTimes(2);
});
