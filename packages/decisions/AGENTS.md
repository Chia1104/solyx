# `@solyx/decisions`

Decisions models, which answer typed questions with probabilities instead of writing text, one module per vendor. They implement the contracts in `@solyx/core/sentiment`, judge the agent's shell commands and the code of the user's strategies for conversations set to auto, read research's claims against their quotes (`ClaimAuditor` from `@solyx/core/report`) and read how each fact a forecast rests on bears on the share price (`FactReader` from `@solyx/core/forecast`). `./typesafe` runs TypeSafe's models, such as Jev, and serves endpoints that speak its `/v1/systemone` API; `./cloudflare` runs Cloudflare's Clef on Workers AI; `./openai` runs OpenAI's Decisions API on an API key of its own, since ChatGPT sign-in does not reach that API.

## Boundaries

- `./provider` holds no key and makes no request, so the renderer may import it.
- Keep each SDK's logging off, since it can print the texts being judged.
- `src/system-one.ts` holds the one set of questions, in TypeSafe's System One format, and reads every vendor's answers; a vendor's module only carries a request to its model. A vendor whose model reads a shared question badly rewords that question in its own module, as `./cloudflare` does for one command question, rather than bending the shared wording. A default model is pinned to a version where the vendor versions its models, so the questions keep the behaviour they were measured against.
- Questions say what a text does rather than what it does not: Jev is weak on negation.
- A text too long for the shortest reader is cut, except a shell command and a strategy's code: their judges reject what they cannot read whole, since what a cut left out would still run.
- Five scripts measure a question against labelled synthetic samples, and a line elsewhere rests on each result. Run a script again for every provider after changing its question, and for a provider after changing its default model.
  - `scripts/eval-claims.ts`: `CLAIM_SUPPORT_LINE` in `@solyx/core/report`, and how `eventClaim` there words the day of a report's event.
  - `scripts/eval-speakers.ts`: `SPEAKER_CONFIDENCE` in `@solyx/core/news`.
  - `scripts/eval-commands.ts`, on a real key for the provider `DECISIONS_PROVIDER` names: the agent's threshold for running a command unasked.
  - `scripts/eval-code.ts`, on a real key for the provider `DECISIONS_PROVIDER` names: the threshold under which a strategy's code is allowed unasked.
  - `scripts/eval-facts.ts`: `EVIDENCE_LEAN_LINE` in `@solyx/core/forecast`.
- The claim auditor sees a claim and its quote alone, never the source. The fact reader sees a fact and its quote alone too, never the forecast they were given for or a price, and what it gives is a reading of words: nothing treats it as the probability of a price.
