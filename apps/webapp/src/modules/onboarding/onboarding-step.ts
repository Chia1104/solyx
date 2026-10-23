import * as z from "zod";

/** First-run setup in order, one screen each; setup the app gains later becomes another step. */
export const OnboardingStep = {
  Welcome: "welcome",
  MarketData: "market-data",
  Agent: "agent",
  WebSearch: "web-search",
  Decisions: "decisions",
  Done: "done",
} as const;

export type OnboardingStep =
  (typeof OnboardingStep)[keyof typeof OnboardingStep];

export const onboardingStepSchema = z.enum(OnboardingStep);

export const ONBOARDING_STEPS: readonly OnboardingStep[] =
  Object.values(OnboardingStep);
