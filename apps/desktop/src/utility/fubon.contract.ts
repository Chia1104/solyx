import { asyncIteratorObject, oc, type } from "@orpc/contract";
import * as z from "zod";

import type {
  FubonAccount,
  FubonFill,
  FubonHoldings,
  FubonOrder,
  FubonOrderObject,
  FubonRealtime,
  FubonSessionOptions,
} from "@solyx/brokers/fubon";

import type { Change } from "../shared/rpc/changes.ts";

/** One of the sign-in's stock accounts, by its `fubonAccountId`. */
const accountSchema = z.string().min(1);

/** An exchange-local day, from which a read reaches through today. */
const fromSchema = z.iso.date();

const historySchema = z.object({ account: accountSchema, from: fromSchema });

/** What the main process asks of the Fubon process, which holds one session for its lifetime. */
export const fubonContract = {
  /** Signs in with the decrypted credentials, which only the main process sends. */
  open: oc.input(type<FubonSessionOptions>()).output(type<FubonAccount[]>()),
  /** Exchanges the session for a market data token. */
  realtime: oc.output(type<FubonRealtime>()),
  /** What the stock account holds and owes now. */
  holdings: oc.input(accountSchema).output(type<FubonHoldings>()),
  orders: oc.input(historySchema).output(type<FubonOrder[]>()),
  fills: oc.input(historySchema).output(type<FubonFill[]>()),
  /** Places an order and answers with the order Fubon gave back. */
  place: oc
    .input(type<{ account: string; order: FubonOrderObject }>())
    .output(type<FubonOrder>()),
  /** Cancels today's order by its id. */
  cancel: oc
    .input(z.object({ account: accountSchema, id: z.string().min(1) }))
    .output(type<void>()),
  /** Yields each time Fubon tells of an order of the account being placed, changed or filled. */
  changes: oc.output(asyncIteratorObject(type<Change>())),
  /** Signs out, after which the main process ends the process. */
  close: oc.output(type<void>()),
};
