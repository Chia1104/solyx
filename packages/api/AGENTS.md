# `@solyx/api`

The backend's API: each module's oRPC contract, and what the backend and its clients both read of a module besides it. The desktop's backend serves it, and its renderer calls it.

## Boundaries

- `rpc/<module>.contract.ts` is a module's contract, ending in `<module>Contract`: a zod schema for every input, since a client's input is untrusted, and `type<T>()` outputs. A procedure that takes one value takes it as its input, and one that takes several an object naming them. `rpc/router.contract.ts` only composes them, and a client imports only its type.
- `<module>.ts` holds what the backend and its clients read of a module besides its contract, such as its shapes, enums, the schemas a form shares with its procedure, and helpers.
- A paired device may call only a procedure whose contract carries `forDevices(true)` from `rpc/access.ts`; a window may call every one. Mark one only when what it reads or does is the workspace's own, never when it sends or cancels an order at the broker, answers the agent's call, unseals or saves a secret, signs in, changes a setting, restores, pairs a device or leaves the computer's windows a destination.
- A client imports every module, so none makes a request, holds a key or reads a Node-only API.
