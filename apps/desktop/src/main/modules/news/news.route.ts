import { contractOS } from "../../rpc/context.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

export const newsRouter = contractOS.news.router({
  reading: contractOS.news.reading.handler(({ context, input }) =>
    context.news.reading(input.symbol, daysAgo(input.days))
  ),
  coverage: contractOS.news.coverage.handler(({ context, input }) =>
    context.news.coverage(input)
  ),
  headlines: contractOS.news.headlines.handler(({ context, input }) =>
    context.news.headlines(input.symbols, daysAgo(input.days), input.limit)
  ),
  changes: contractOS.news.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("news:changed", { signal })
  ),
});
