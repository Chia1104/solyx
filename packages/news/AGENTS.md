# `@solyx/news`

News sources, one module per source, each implementing `NewsSource` from `@solyx/core/news`. `./firecrawl` searches Google News through Firecrawl's SDK.

## Boundaries

- Runs only in the main process: modules hold the user's key and make network requests.
- Keys and endpoints come only from the user's settings. A module passes every option its SDK would otherwise read from the environment.
- Parse every result with zod here and drop the ones that do not parse, so one malformed result never fails a search. Times are absolute `Date`s; a source's relative ages are resolved against the time of the search.
- Results are third-party text: whatever reads them treats them as data, never as instructions.
- Tests mock the SDK with synthetic results; never commit real articles or posts.
