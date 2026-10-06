import type { Context } from "@earendil-works/chord";
import { defineDoc } from "@earendil-works/pi-durable";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { uniq } from "es-toolkit";

/**
 * The addresses the conversation's own searches and news showed the model. A page among them was
 * found by the app rather than written by the model, so it can carry nothing the model put in it.
 */
const FoundAddressesDoc = defineDoc<{ urls: string[] }>({
  kind: "solyx.found-addresses",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ urls: [] }),
});

/** Notes the addresses a tool's result shows the model. */
export async function rememberAddresses(
  api: ToolExecutionApi,
  urls: readonly string[],
  context: Context
): Promise<void> {
  if (urls.length === 0) return;

  await api.commit(async (tx) => {
    const found = await tx.doc(FoundAddressesDoc, api.conversationId);

    found.urls = uniq([...found.urls, ...urls]);
  }, context);
}

/** Whether the conversation's searches or news showed exactly this address. */
export const isFoundAddress = (
  api: ToolExecutionApi,
  url: string,
  context: Context
): Promise<boolean> =>
  api.commit(
    async (tx) =>
      (await tx.doc(FoundAddressesDoc, api.conversationId)).urls.includes(url),
    context
  );
