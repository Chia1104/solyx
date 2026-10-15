import { contractOS } from "../../rpc/context.ts";

export const accountRouter = contractOS.account.router({
  summary: contractOS.account.summary.handler(async ({ context }) => ({
    brokerMode: context.desk.mode,
    ...(await context.desk.account()),
  })),
});
