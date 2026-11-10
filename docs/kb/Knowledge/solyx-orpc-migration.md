---
type: fact
title: "Moving solyx's Electron process boundaries onto oRPC v2 (2026-10-15): the user's decisions, the stack #169 → #170 → #172 → #173 → #174 (all merged 2026-10-15), the conventions it set and the gotchas hit"
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-11
tags:
  - imported/claude-code
approved_at: 2026-11-10
approved_by: auto-approve
---

# Moving solyx's Electron process boundaries onto oRPC v2 (2026-10-15): the user's decisions, the stack #169 → #170 → #172 → #173 → #174 (all merged 2026-10-15), the conventions it set and the gotchas hit

Started 2026-10-15 at the user's request, modelled on chia1104.dev's contract-first services (contracts per module, `contractOS = implement(routerContract).$context<…>()`, `RouterContractClient` + `createTanstackQueryUtils`).

The user decided:

- Use the newest oRPC beta (2.0.0-beta.43 then; chia1104.dev was on beta.32).
- Keep camelCase procedure keys, not chia1104.dev's kebab-case.
- Pushes go through `@orpc/publisher`'s `MemoryPublisher`, picked for memory: it keeps at most 100 unread events per subscriber (oldest dropped), releases on abort or port close, and keeps nothing when resume is off. `node:events` `on()` buffers without bound and yields untyped arrays.
- The backup worker stays on its own protocol for now.

**Why:** It replaces bindIpc channel maps, `webContents.send` broadcasts and the Fubon id/answer protocol with typed contracts. Contracts must live in `src/shared` (now `packages/api`, since #293), since the renderer's tsconfig cannot read main's types.

**How to apply:** The whole stack was built and merged into develop on 2026-10-15 (`d57784e`…`9b0dddf`); new procedures follow its conventions below. What each PR held:

- #169 (`feat/orpc-ipc`): infra plus proposals, inbox and account.
- #170 (`feat/orpc-modules`): the thirteen small modules.
- #172 (`feat/orpc-settings`): settings.
- #173 (`feat/orpc-market-agent`): market and agent, and removes `bindIpc`, `window.solyx`, `shared/ipc` and the contextBridge.
- #174 (`feat/orpc-fubon`): the Fubon utility process.

Conventions the stack set, also recorded in desktop `AGENTS.md` then and in `packages/api/AGENTS.md` since the backend split:

- Shapes live in `shared/<module>.ts` and contracts in `shared/rpc/<module>.contract.ts` (now `packages/api/src/<module>.ts` and `packages/api/src/rpc/<module>.contract.ts`); the renderer imports a contract only for its type.
- A procedure that takes one value takes it as its input; one that takes several takes a named object.
- Pushes are `changes` streams over the services' `windowEvents` (`MemoryPublisher`), followed in the renderer with `forEachEvent`.
- A mutation that only calls its procedure uses `orpc.x.y.mutationOptions()`; listings go into inputs as they are (the user had `symbolInput` removed in review).
- `settings` implements its router on its own context (`SettingsContext`), so its tests run through `createRouterClient` with `keepMessages`.
- `agent.events` keeps every event it has not sent (`maxBufferedEvents: Infinity`), and each live-candles stream is one hub watch.

Gotchas:

- oRPC masks any error that is not an `ORPCError` as "Internal server error". `keepMessages` in `main/rpc/messages.ts` (now `packages/backend/src/rpc/messages.ts`) keeps it, for windows and for the Fubon process alike.
- `MemoryPublisher<T extends Record<string, object>>` rejects interfaces, and lint's consistent-type-definitions rewrites `type X = {…}` into one, so `WindowEvents` is a `Record<…>`. Payloads are objects; a bare change is `{}`.
- anti-slop forbids `as unknown as` and `unknown` parameters, so tests use a real `OrderDesk` and a `MemoryPublisher` subclass.
- The preload now reads `window`, so it has its own DOM tsconfig.
- In the smoke run, the first "Create proposal" click right after filling the number fields was swallowed, and a second click worked.

Related: [[solyx-isolated-smoke-run]], [[solyx-commit-to-main]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-orpc-migration.md`, type `project`).
