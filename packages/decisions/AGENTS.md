# `@solyx/decisions`

Decisions models, which answer typed questions with probabilities instead of writing text: one module per vendor, each implementing the contracts in `@solyx/core/sentiment`. `./typesafe` runs TypeSafe's models, such as Jev, through `@typesafe-ai/sdk`.

## Boundaries

- Runs only in the main process: modules hold the user's key and make network requests.
- The model, key and endpoint come only from the user's settings (`decisions.model`, `decisions.baseURL` and the `decisions-api-key` secret). A module passes every option its SDK would otherwise read from the environment, and keeps the SDK's logging off, since it can print the texts being judged.
- Questions and their wording belong to the vendor's module, because they are written against that vendor's model; a new vendor brings its own rather than sharing a generic question set. Its default model is pinned to a version for the same reason.
- Questions say what a text does rather than what it does not: Jev is weak on negation.
- Tests use synthetic responses shaped like the vendor's; never commit real posts or articles.
