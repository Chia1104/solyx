import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OnboardingState {
  /** Finished or skipped, so setup is not offered again on launch. */
  finished: boolean;
}

interface OnboardingActions {
  finish: () => void;
}

export type OnboardingStore = OnboardingState & OnboardingActions;

const persistedOnboardingSchema = z.object({ finished: z.boolean() });

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      finished: false,
      finish: () => set({ finished: true }),
    }),
    {
      name: "solyx.onboarding",
      version: 1,
      // Local storage outlives app versions, so anything that no longer parses is dropped.
      merge: (persisted, current) => ({
        ...current,
        ...persistedOnboardingSchema.safeParse(persisted).data,
      }),
    }
  )
);
