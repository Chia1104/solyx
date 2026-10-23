# `@solyx/utils`

Cross-runtime, domain-neutral utilities shared by the desktop's backend and main process, the renderer and tests.

## Boundaries

- Domain rules such as market rules, risk checks and broker behavior belong in their owning package even when they could be expressed as a generic helper.
- Keep Node-only helpers under a `server` export and out of modules the renderer imports.
- `./date` names a clock only by its IANA time zone. A market's clock and calendar, which tie it to an exchange, stay in `@solyx/core/market`.
- A reader of JSON takes the zod schema it reads through and answers `undefined` for text that is not JSON or does not match, so each caller decides what a bad file means. Only a failure to read a file that is there throws.
