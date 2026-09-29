# `@solyx/utils`

Cross-runtime, domain-neutral utilities shared by the main process, the renderer and tests.

## Boundaries

- Check `es-toolkit` before adding a helper; this package holds only what it lacks.
- Keep modules small and importable through their explicit export path; do not turn this package into a miscellaneous root barrel.
- Domain rules such as market rules, risk checks and broker behavior belong in their owning package even when they could be expressed as a generic helper.
- Keep Node-only helpers under a `server` export and out of modules the renderer imports.
