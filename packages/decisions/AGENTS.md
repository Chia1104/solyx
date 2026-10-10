# `@solyx/decisions`

Decisions models, which answer typed questions with probabilities instead of writing text: one module per vendor, each implementing the contracts in `@solyx/core/sentiment`, judging the agent's shell commands for conversations set to auto, and reading the claims in its research against their quotes (`ClaimAuditor` from `@solyx/core/report`). `./typesafe` runs TypeSafe's models, such as Jev, through `@typesafe-ai/sdk`, and also serves endpoints that speak its `/v1/systemone` API. `./cloudflare` runs Cloudflare's Clef on Workers AI over `fetch`. `./openai` runs OpenAI's Decisions API through `openai`, on an API key of its own: ChatGPT sign-in does not reach that API. `./provider` names the vendors and `./command` holds the command judge's contract.

## Boundaries

- `./provider` holds no key and makes no request, so the renderer may import it.
- The provider, model, key and endpoint are the settings `decisions.provider`, then `model` and `baseURL` under `decisions.<provider>`, Cloudflare's `accountId`, and one secret per provider. Keep each SDK's logging off, since it can print the texts being judged.
- `src/system-one.ts` holds the one set of questions, in TypeSafe's System One format, and reads every vendor's answers; a vendor's module only carries a request to its model. A vendor whose model reads a shared question badly rewords that question in its own module, as `./cloudflare` does for one command question, rather than bending the shared wording. A default model is pinned to a version where the vendor versions its models, so the questions keep the behaviour they were measured against.
- Questions say what a text does rather than what it does not: Jev is weak on negation.
- Three scripts measure a question against labelled synthetic samples, and a line elsewhere rests on each result. Run a script again for every provider after changing its question, and for a provider after changing its default model.
  - `scripts/eval-claims.ts`: `CLAIM_SUPPORT_LINE` in `@solyx/core/report`, below which research refuses a claim.
  - `scripts/eval-speakers.ts`, the question of who wrote a text given where it was published: `SPEAKER_CONFIDENCE` in `@solyx/core/news`, below which a story's channel names its speaker instead.
  - `scripts/eval-commands.ts`, on a real key for the provider `DECISIONS_PROVIDER` names: the agent's threshold for running a command unasked.
- The claim auditor sees a claim and its quote alone, never the source.
