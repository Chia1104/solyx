import type { CredentialStore } from "@earendil-works/pi-ai";
import { expect, test, vi } from "vite-plus/test";

import { createModelCatalog } from "../src/models.ts";
import { AgentProvider, DEFAULT_MODEL } from "../src/providers.ts";

// No credential is ever saved here; sign-ins are cancelled before they return.
const NO_CREDENTIALS: CredentialStore = {
  read: async () => undefined,
  list: async () => [],
  modify: async () => undefined,
  delete: async () => undefined,
};

function setup() {
  const openExternal = vi.fn();

  const catalog = createModelCatalog({
    credentials: NO_CREDENTIALS,
    appName: "Solyx",
    getDeviceId: () => "00000000-0000-4000-8000-000000000000",
    openExternal,
  });

  return { catalog, openExternal };
}

test("a model the provider does not list reads as its default", () => {
  const { catalog } = setup();

  expect(catalog.model(AgentProvider.Anthropic, "gone")?.id).toBe(
    DEFAULT_MODEL[AgentProvider.Anthropic]
  );
  expect(catalog.model(AgentProvider.Anthropic, undefined)?.id).toBe(
    DEFAULT_MODEL[AgentProvider.Anthropic]
  );
  expect(
    catalog.options(AgentProvider.Anthropic).map((option) => option.id)
  ).toContain(DEFAULT_MODEL[AgentProvider.Anthropic]);
});

test("signing in again replaces a sign-in still open, and cancelling ends it quietly", async () => {
  const { catalog, openExternal } = setup();
  const page = () => "";

  const first = catalog.signIn(AgentProvider.OpenAI, page);

  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());

  // Its browser page was closed, so the user starts over.
  const second = catalog.signIn(AgentProvider.OpenAI, page);

  await expect(first).resolves.toBeUndefined();
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));

  catalog.cancelSignIn();

  await expect(second).resolves.toBeUndefined();
});

test("only a provider with a subscription signs in", async () => {
  const { catalog } = setup();

  await expect(
    catalog.signIn(AgentProvider.Anthropic, () => "")
  ).rejects.toThrow("no subscription sign-in");
});
