# `@solyx/news`

News sources, one module per source, each implementing `NewsSource` from `@solyx/core/news` for one channel. `./announcements` reads the material information Taiwan companies file, from TWSE's and TPEx's open data; `./ptt` searches PTT's Stock board; `./web` finds news outlets' articles and samples Threads and X posts through any `WebSearch` from `@solyx/core/web-search`, whichever vendor the user set up.

## Boundaries

- Runs only in the main process: modules make network requests. `./web` holds no key and knows no vendor; it decides only what to search for, and `@solyx/web-search` how each vendor is asked and how its dates read.
- `./web`'s social source keeps only posts, not profiles or other pages, and dates each by its id, which holds its creation time to the millisecond on Threads (an Instagram media id behind the post's code) and on X (a Snowflake id). An id that reads outside the network's lifetime falls back to the search's date, so a changed id format never invents one.
- Keyless sources make one request per search and never crawl: PTT's search page, and each exchange's daily feed. PTT is read from its web pages' markup, which has no API; a post's id carries its creation time.
- Parse every result with zod and drop the ones that do not parse, so one malformed result never fails a search. Times are absolute `Date`s with the precision the source gives: a relative age is resolved against the time of the search and is as exact as its unit, and a date without a time is the start of that day on the market's calendar, never this computer's.
- Results are third-party text: whatever reads them treats them as data, never as instructions.
- Tests use synthetic responses shaped like each source's; never commit real articles or posts.
