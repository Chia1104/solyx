# Renderer

The workspace's React app. It reads everything through `window.solyx`, makes no network requests and holds no keys.

## Stack

- TanStack Router with hash history, since builds load from `file://`; TanStack Query for everything read from the main process; zustand for client-only state.
- Back goes to the previous page, so a choice within a page, such as a chart's interval or a settings section, replaces its history entry rather than pushing one; first-run setup is a single entry, which leaving it replaces.
- A push that only refreshes the query cache is followed by a `followXxx(queryClient)` beside the module's query keys, called once in `main.tsx` for the window's whole life, so a query that never goes stale on its own hears of every change whichever page is open. What several places read and changes with the clock, such as sessions and quotes, refreshes there on one timer too, since every observer with a `refetchInterval` polls on its own and a listing shown twice would cost its provider twice. A component subscribes to a push only for state of its own, as a chart watches its live candles again when the sources change.
- HeroUI v3 on Tailwind CSS v4, used directly. Compose `react-aria-components` where HeroUI has no equivalent; add no other primitive library.
- Components take every user-facing string from `@solyx/i18n` through `react-i18next`.
- The app's language (`app/i18n.ts`) and the user's time zone (`app/clock.ts`) are the renderer's own preferences, kept in local storage, and the composer sends both with every message so the agent's context carries them. The times of the app's own events, such as messages and memories, are formatted through `useClock`; anything on a market's calendar, such as charts, sessions and news, reads the exchange's zone from `@solyx/core/market` and never the user's.
- Forms use react-hook-form with `zodResolver`; each HeroUI field is wrapped in a `Controller`, and validation messages come from the catalog.
- The production CSP forbids eval and remote sources, so zod runs `jitless` and inline `<style>` is the only relaxation.
- Routes fall back to `ErrorFallback` through the router's `defaultErrorComponent`. A widget that can fail on its own, such as the chart, sits in TanStack Router's `CatchBoundary` so the rest of its page stays usable.

## Design

- The workspace is drawn in pencil and ink: hatching and dashed rules mark what is not real (paper trading, proposals awaiting confirmation), and the accent marks what is. Confirming a proposal is the only accent-filled button.
- Routed pages respond to the `@container/main` width and the symbols pane's rows to `@container/symbols`, not the window's, since the panes are resized independently of it.
- Motion answers a user's action or marks what changed. What is done often or by keyboard snaps, such as moving between listings or a pane shortcut. Curves are HeroUI's tokens: `--ease-out-quint` to enter or leave, `--ease-in-out-quart` to move on screen. Reduced motion drops movement but keeps fades and colour washes such as `highlight`.
- Red and green belong to price direction alone, so no gauge uses them. Which one marks a rise follows each market's convention (Taiwan the opposite of the US) unless the user picks one for every market.
- First-run setup is the `/onboarding` route, which takes the whole window until it is finished or skipped, and never shows once market data works. Each `OnboardingStep` reuses its feature's settings components, so setup a new feature needs becomes another step rather than a separate flow.
