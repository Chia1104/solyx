import { openFubonSession } from "@solyx/brokers/fubon";
import type { FubonSession } from "@solyx/brokers/fubon";
import { errorMessage } from "@solyx/utils/error";

import { FubonMethod } from "./fubon-protocol.ts";
import type {
  FubonAnswers,
  FubonReply,
  FubonRequest,
} from "./fubon-protocol.ts";

let session: FubonSession | undefined;

function signedIn(): FubonSession {
  if (!session) throw new Error("Not signed in to Fubon");

  return session;
}

function answer(request: FubonRequest): FubonAnswers[FubonMethod] {
  switch (request.method) {
    case FubonMethod.Open:
      session = openFubonSession(request.options);

      return session.accounts;

    case FubonMethod.Realtime:
      return signedIn().realtime();

    case FubonMethod.Close:
      session?.close();
      session = undefined;

      return null;
  }
}

// Every SDK call blocks until Fubon answers, so requests are answered one at a time, in order.
process.parentPort.on("message", ({ data }) => {
  // SAFETY: only the main process posts here, and it posts nothing but FubonRequests.
  const request = data as FubonRequest;

  let reply: FubonReply;

  try {
    reply = { id: request.id, answer: answer(request) };
  } catch (error) {
    reply = { id: request.id, error: errorMessage(error) };
  }

  process.parentPort.postMessage(reply);
});
