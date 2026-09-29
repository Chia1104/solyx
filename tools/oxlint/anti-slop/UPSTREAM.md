# Vendored anti-slop

- **Source:** [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), copied from the `install-anti-slop` skill's bundled `assets/anti-slop`.
- **Snapshot:** skill folder hash `89044d21c75a367eac1ddbaf208e650b1a7d5820` (`skills/install-anti-slop`, as recorded in `~/.agents/.skill-lock.json`, skill updated 2026-09-12). The upstream commit is unknown; compare against that folder hash when updating.
- **Installed:** 2026-09-29 with `node <skill>/scripts/install.mjs`, default destination.
- **Installed paths:** `index.ts`, `rules/`, `shared/`, `vendor/eslint-stylistic/` (with its own `LICENSE` and `UPSTREAM.md`) and `effect/`.
- **License:** MIT. The skill bundle ships no license file, so `LICENSE` was added from the upstream repository (blob `69239ead1ed4a05db45c0da08d1b8f64c0a76ee4`). Keep it with this directory; the rest of Solyx is AGPL-3.0-or-later.

## Local deviations

- Plugin source is unmodified.
- `effect/` is copied but not registered: the repository has no direct `effect` dependency.
- Registration lives in the root `vite.config.ts` (`lint.jsPlugins`, `lint.rules`); `oxc/no-accumulating-spread` and every generic rule are at `error`, except `no-array-filter-map`, which is off because its preferred iterator-helper form is not in the repository's es2023 `lib`.
- Migrated from the configuration in `chia1104.dev/toolings/oxlint`, whose rule sources were an older, locally unmodified snapshot. Its test-file override that turned off `anti-slop/no-module-mocking` was not carried over.
