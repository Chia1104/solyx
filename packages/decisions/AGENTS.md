# `@solyx/decisions`

Decisions models, which answer typed questions with probabilities instead of writing text: one module per vendor, each implementing the contracts in `@solyx/core/sentiment` and judging the agent's shell commands for conversations set to auto. `./typesafe` runs TypeSafe's models, such as Jev, through `@typesafe-ai/sdk`, and also serves endpoints that speak its `/v1/systemone` API. `./cloudflare` runs Cloudflare's Clef on Workers AI over `fetch`. `./provider` names the vendors and `./command` holds the command judge's contract.

## Boundaries

- Runs only in the main process: modules hold the user's key and make network requests. `./provider` alone holds neither, so the renderer may import it.
- The provider, model, key and endpoint come only from the user's settings (`decisions.provider`, then `model` and `baseURL` under `decisions.<provider>`, Cloudflare's `accountId`, and one secret per provider). A module passes every option its SDK would otherwise read from the environment, and keeps the SDK's logging off, since it can print the texts being judged.
- `src/system-one.ts` holds the one set of questions, in TypeSafe's System One format, and reads every vendor's answers; a vendor's module only carries a request to its model. A vendor whose model reads a shared question badly rewords that question in its own module, as `./cloudflare` does for one command question, rather than bending the shared wording. A default model is pinned to a version where the vendor versions its models, so the questions keep the behaviour they were measured against.
- Questions say what a text does rather than what it does not: Jev is weak on negation.
- Tests use synthetic responses shaped like the vendor's; never commit real posts or articles.
- `scripts/eval-commands.ts` measures the command questions against labelled synthetic commands on a real key, for the provider `DECISIONS_PROVIDER` names. Run it again for every provider after changing a question, and for a provider after changing its default model, since the agent's threshold for running a command unasked rests on its result.
