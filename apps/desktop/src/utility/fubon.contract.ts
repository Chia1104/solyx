import { oc, type } from "@orpc/contract";

import type {
  FubonAccount,
  FubonRealtime,
  FubonSessionOptions,
} from "@solyx/brokers/fubon";

/** What the main process asks of the Fubon process, which holds one session for its lifetime. */
export const fubonContract = {
  /** Signs in with the decrypted credentials, which only the main process sends. */
  open: oc.input(type<FubonSessionOptions>()).output(type<FubonAccount[]>()),
  /** Exchanges the session for a market data token. */
  realtime: oc.output(type<FubonRealtime>()),
  /** Signs out, after which the main process ends the process. */
  close: oc.output(type<void>()),
};
