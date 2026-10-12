# `@solyx/macro`

Schedules of economic releases and the figures they bring, one module per source, each implementing `MacroCalendarProvider` or `MacroFiguresProvider` from `@solyx/core/macro`. `./stat-gov-tw` reads Taiwan's schedule from the national statistics portal's release calendar, which lists each agency's releases for the coming twelve months. `./dgbas` reads Taiwan's figures from the macro database of the Directorate-General of Budget, Accounting and Statistics, which gathers the other agencies' too and whose API needs no key.

## Boundaries

- A module follows a fixed list of releases that move the market, each named by the source's own id for it, never by its title, and maps each to a `MacroIndicator`; the rest of a source's calendar is left out.
- Drop an entry that does not parse, so one odd entry never hides the rest. A day the source gives only as a latest day is a `Deadline`. A release's page is the first its source links that is an https address, since a source lists the agency's news before its databases, and a time that does not read is left empty rather than dropping its day.
- A figures module follows a fixed list of tables and figures by the source's own codes, and checks what the source names each item it reads, so a renumbered table fails rather than passing another figure off as the one followed. One table failing fails the read, since figures that come only in part would be taken for whole.
- `./dgbas` asks the database's API in the ways its document leaves out: a query names three dimensions whatever its table has, a query it does not take answers the table's web page rather than an error, and a period not out yet answers 0, so a series ends at its newest period that is not 0. It reads levels alone and leaves growth to `@solyx/core/macro`.
