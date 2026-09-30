# `@solyx/agent`

The trading agent on pi (`@earendil-works/pi-agent-core` and `pi-ai`): its runtime, tools, prompt and skills, and the wire events a renderer folds into a conversation.

## Boundaries

- Everything but `./wire` and `./providers` runs only in the main process: it holds API keys and calls providers. Those two import nothing from pi, so the renderer uses them for the event union, tool names, the fold and the provider and thinking choices.
- Tools read through `TradingToolPorts` and may only call `OrderDesk.propose` and `check`, never `confirm`; see the trading invariants. `propose_order` accepts one proposal per run, so tools are built again for every run.
- Keys come only from the settings the user saved: `createModelCatalog` gives pi-ai an auth context with no environment or files, and each run passes its key explicitly.
- A conversation persists through `AgentSessionStore`, which `@solyx/db/user` implements. Each message is stored on pi's `message_end`, before its event goes out, and only user, assistant and tool result messages are kept; the system prompt is rebuilt for every run.
- The app's per-turn context (time, sessions, account mode, the listing on screen, the reply language) rides in the user message as an `<app_context>` block rather than in the system prompt, so the prompt stays cacheable and a replayed transcript sends the same bytes. `userText` strips it for display.
- A run that never finished, because the app exited, replays as `interrupted`, and its calls without results as aborted; nothing resumes it.
- Prompts and skills are written for Solyx. Do not copy prompt or skill text from other projects whose licenses differ.
