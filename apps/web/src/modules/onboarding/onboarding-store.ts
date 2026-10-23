import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { persistOptions } from "../../app/persist.ts";

interface OnboardingState {
  /** Finished or skipped, so setup is not offered again on launch. */
  finished: boolean;
}

interface OnboardingActions {
  finish: () => void;
}

type OnboardingStore = OnboardingState & OnboardingActions;

const persistedOnboardingSchema = z.object({ finished: z.boolean() });

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      finished: false,
      finish: () => set({ finished: true }),
    }),
    persistOptions<OnboardingStore>("onboarding", persistedOnboardingSchema)
  )
);
