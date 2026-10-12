# `@solyx/macro`

Schedules of economic releases, one module per source, each implementing `MacroCalendarProvider` from `@solyx/core/macro`. `./stat-gov-tw` reads Taiwan's from the national statistics portal's release calendar, which lists each agency's releases for the coming twelve months.

## Boundaries

- A module follows a fixed list of releases that move the market, each named by the source's own id for it, never by its title, and maps each to a `MacroIndicator`; the rest of a source's calendar is left out.
- Drop an entry that does not parse, so one odd entry never hides the rest. A day the source gives only as a latest day is a `Deadline`. A release's page is the first its source links that is an https address, since a source lists the agency's news before its databases, and a time that does not read is left empty rather than dropping its day.
