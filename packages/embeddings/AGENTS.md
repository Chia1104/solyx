# `@solyx/embeddings`

Embedding endpoints, each implementing `Embedder` from `@solyx/core/embedding`. `./openai-compatible` speaks OpenAI's `/embeddings`, which Ollama and LM Studio copy, so one module serves both a model on this computer and OpenAI's. `./provider` names where embeddings come from and what each runs by default.

## Boundaries

- `./provider` holds no key and makes no request, so the renderer may import it.
- The endpoint, model and vector length come from the caller, and a server on this computer takes no key. A failure's message names the server's host.
- Each line in `STORY_LINES` in `@solyx/core/news` rests on two measurements of its space: `scripts/eval-stories.ts`, the lowest line that joins no pair of synthetic headlines telling different stories, and pairs of collected news a person read under the grouping rule's conditions, which joined more different stories than the samples did. Measure a space both ways before it joins the table and again after changing what `storyText` reads, and leave a margin above both, since OpenAI's vectors shift slightly between calls.
- `scripts/eval-memories.ts` measures, the same way, how alike a memory and one that only says it again read against memories of one kind and listing that hold different things; each line in `MEMORY_LINES` in `@solyx/core/memory` rests on it.
