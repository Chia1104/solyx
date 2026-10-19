import { oc, type } from "@orpc/contract";
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

/** An exchange-local day, from which a read reaches through today. */
const fromSchema = z.iso.date();

/** What the main process asks of the Fubon process, which holds one session for its lifetime. */
export const fubonContract = {
  /** Signs in with the decrypted credentials, which only the main process sends. */
  open: oc.input(type<FubonSessionOptions>()).output(type<FubonAccount[]>()),
  /** Exchanges the session for a market data token. */
  realtime: oc.output(type<FubonRealtime>()),
  /** What the stock account holds and owes now. */
  holdings: oc.output(type<FubonHoldings>()),
  orders: oc.input(fromSchema).output(type<FubonOrder[]>()),
  fills: oc.input(fromSchema).output(type<FubonFill[]>()),
  /** Places an order and answers with the order Fubon gave back. */
  place: oc.input(type<FubonOrderObject>()).output(type<FubonOrder>()),
  /** Cancels today's order by its id. */
  cancel: oc.input(z.string()).output(type<void>()),
  /** Signs out, after which the main process ends the process. */
  close: oc.output(type<void>()),
};
