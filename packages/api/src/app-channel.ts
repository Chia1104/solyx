/** Which build of the app runs: a development run, or the channel a packaged build was made for. */
export const AppChannel = {
  Development: "development",
  Nightly: "nightly",
  Stable: "stable",
  Test: "test",
} as const;

export type AppChannel = (typeof AppChannel)[keyof typeof AppChannel];
