import { contractOS } from "../../rpc/context.ts";

export const calendarRouter = contractOS.calendar.router({
  upcoming: contractOS.calendar.upcoming.handler(({ context, input }) =>
    context.calendar.upcoming(input.symbols, input.days)
  ),
});
