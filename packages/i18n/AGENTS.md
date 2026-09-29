# `@solyx/i18n`

Static translation catalogs, one folder per consumer (`desktop/`), one JSON file per locale. `en-US` is the source locale.

## Boundaries

- Keep every locale in a folder key-for-key and variable-for-variable compatible with `en-US`; `tests/locales.test.ts` enforces it.
- Add messages to the owning catalog instead of app-local duplicates or hard-coded UI strings.
- This package exports JSON data only; locale negotiation, formatting and rendering stay in consumers.
- Domain code returns codes and data, not sentences; catalogs turn them into text (for example `risk.*` for `RiskViolation`).
