# Renderer

The workspace's React app. It reads everything through `window.solyx`, makes no network requests and holds no keys.

## Stack

- TanStack Router with hash history, since builds load from `file://`; TanStack Query for everything read from the main process; zustand for client-only state.
- HeroUI v3 on Tailwind CSS v4, used directly. Compose `react-aria-components` where HeroUI has no equivalent; add no other primitive library.
- Components take every user-facing string from `@solyx/i18n` through `react-i18next`.
- Forms use react-hook-form with `zodResolver`; each HeroUI field is wrapped in a `Controller`, and validation messages come from the catalog.
- The production CSP forbids eval and remote sources, so zod runs `jitless` and inline `<style>` is the only relaxation.
- Routes fall back to `ErrorFallback` through the router's `defaultErrorComponent`. A widget that can fail on its own, such as the chart, sits in TanStack Router's `CatchBoundary` so the rest of its page stays usable.

## Design

- The workspace is drawn in pencil and ink: hatching and dashed rules mark what is not real (paper trading, proposals awaiting confirmation), and the accent marks what is. Confirming a proposal is the only accent-filled button.
- Routed pages respond to the `@container/main` width and the symbols pane's rows to `@container/symbols`, not the window's, since the panes are resized independently of it.
- Red and green belong to price direction alone, so no gauge uses them. Which one marks a rise follows each market's convention (Taiwan the opposite of the US) unless the user picks one for every market.
- First-run setup is the `/onboarding` route, which takes the whole window until it is finished or skipped, and never shows once market data works. Each `OnboardingStep` reuses its feature's settings components, so setup a new feature needs becomes another step rather than a separate flow.
