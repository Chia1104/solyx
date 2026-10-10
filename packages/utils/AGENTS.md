# `@solyx/utils`

Cross-runtime, domain-neutral utilities shared by the main process, the renderer and tests.

## Boundaries

- Domain rules such as market rules, risk checks and broker behavior belong in their owning package even when they could be expressed as a generic helper.
- Keep Node-only helpers under a `server` export and out of modules the renderer imports.
