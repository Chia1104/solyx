import { symbolKey } from "@solyx/core/market";
import { roundTrips } from "@solyx/core/review";

import { contractOS } from "../../rpc/context.ts";

export const accountRouter = contractOS.account.router({
  summary: contractOS.account.summary.handler(async ({ context }) => ({
    brokerMode: context.desk.mode,
    ...(await context.desk.account()),
  })),
  roundTrips: contractOS.account.roundTrips.handler(async ({ context }) => {
    const [fills, { positions }] = await Promise.all([
      context.desk.fills(0),
      context.desk.account(),
    ]);

    return roundTrips(fills, context.desk.list(), positions);
  }),
  fills: contractOS.account.fills.handler(async ({ context, input }) => {
    const fills = await context.desk.fills(0);

    return input === undefined
      ? fills
      : fills.filter(
          ({ instrument }) => symbolKey(instrument) === symbolKey(input)
        );
  }),
  working: contractOS.account.working.handler(({ context }) =>
    context.desk.working()
  ),
  // A user's own action; the agent's desk cannot cancel.
  cancel: contractOS.account.cancel.handler(({ context, input }) =>
    context.desk.cancel(input)
  ),
});
