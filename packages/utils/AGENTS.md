# `@solyx/utils`

Cross-runtime, domain-neutral utilities shared by the main process, the renderer and tests.

## Boundaries

- Domain rules such as market rules, risk checks and broker behavior belong in their owning package even when they could be expressed as a generic helper.
- Keep Node-only helpers under a `server` export and out of modules the renderer imports.
- `./date` names a clock only by its IANA time zone. A market's clock and calendar, which tie it to an exchange, stay in `@solyx/core/market`.
