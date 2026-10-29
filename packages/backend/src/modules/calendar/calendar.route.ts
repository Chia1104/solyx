import { contractOS } from "../../rpc/context.ts";

export const calendarRouter = contractOS.calendar.router({
  listing: contractOS.calendar.listing.handler(({ context, input }) =>
    context.calendar.listing(input.symbol, input.days)
  ),
  research: contractOS.calendar.research.handler(({ context, input }) =>
    context.calendar.research(input.symbols, input.days)
  ),
  releases: contractOS.calendar.releases.handler(({ context, input }) =>
    context.calendar.releases(input.market, input.days)
  ),
  closures: contractOS.calendar.closures.handler(({ context, input }) =>
    context.calendar.closures(input.market, input.days)
  ),
});
