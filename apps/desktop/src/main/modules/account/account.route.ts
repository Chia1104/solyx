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
});
