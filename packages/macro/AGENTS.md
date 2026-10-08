# `@solyx/macro`

Schedules of economic releases, one module per source, each implementing `MacroCalendarProvider` from `@solyx/core/macro`. `./stat-gov-tw` reads Taiwan's from the national statistics portal's release calendar, which lists each agency's releases for the coming twelve months.

## Boundaries

- Runs only in the main process: modules make network requests.
- A module follows a fixed list of releases that move the market, each named by the source's own id for it, never by its title, and maps each to a `MacroIndicator`; the rest of a source's calendar is left out.
- Parse every entry with zod and drop one that does not parse, so one odd entry never hides the rest. A day the source gives only as a latest day is a `Deadline`.
- Call a source through `ky` with an injectable `fetch`. A failure's message names the source and the reason it gives.
- Tests use synthetic pages shaped like the source's; never commit recorded pages.
