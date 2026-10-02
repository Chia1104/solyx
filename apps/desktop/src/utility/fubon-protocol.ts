import type {
  FubonAccount,
  FubonRealtime,
  FubonSessionOptions,
} from "@solyx/brokers/fubon";

export const FubonMethod = {
  /** Signs in; the process holds one session for its lifetime. */
  Open: "open",
  Realtime: "realtime",
  /** Signs out, after which the main process ends the process. */
  Close: "close",
} as const;

export type FubonMethod = (typeof FubonMethod)[keyof typeof FubonMethod];

export interface FubonAnswers {
  [FubonMethod.Open]: FubonAccount[];
  [FubonMethod.Realtime]: FubonRealtime;
  [FubonMethod.Close]: null;
}

export type FubonCall =
  | { method: typeof FubonMethod.Open; options: FubonSessionOptions }
  | { method: typeof FubonMethod.Realtime }
  | { method: typeof FubonMethod.Close };

/** A call from the main process, answered by the `FubonReply` with the same `id`. */
export type FubonRequest = FubonCall & { id: number };

export type FubonReply = { id: number } & (
  | { answer: FubonAnswers[FubonMethod] }
  | { error: string }
);
