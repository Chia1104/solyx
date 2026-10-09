# `@solyx/embeddings`

Embedding endpoints, each implementing `Embedder` from `@solyx/core/embedding`. `./openai-compatible` speaks OpenAI's `/embeddings`, which Ollama and LM Studio copy, so one module serves both a model on this computer and OpenAI's. `./provider` names where embeddings come from and what each runs by default.

## Boundaries

- Runs only in the main process: the module holds the user's key and makes network requests. `./provider` alone holds neither, so the renderer may import it.
- The endpoint, model, vector length and key come from the caller, never the environment, and a server on this computer takes no key. Call the API through `ky` with an injectable `fetch`, and parse every response with zod; a failure's message names the server's host and the reason it gives.
- An `Embedder`'s `space` names its model and vector length. Vectors from different spaces are never compared, and a line measured on one space does not hold for another.
- `scripts/eval-stories.ts` embeds pairs of synthetic headlines that either tell one story or tell different ones, and measures, on one space, the lowest line that joins no pair of different stories. Each line in `STORY_LINES` in `@solyx/core/news` rests on this result and on pairs of collected news a person read under the grouping rule's conditions, which joined more different stories than the samples did. Measure a space both ways before it joins the table, again after changing what `storyText` reads, and leave a margin above both, since OpenAI's vectors shift slightly between calls.
- Tests and samples are synthetic, shaped like each server's answers; never commit real posts or articles.
