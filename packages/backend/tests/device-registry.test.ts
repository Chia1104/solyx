import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { createDeviceRegistry } from "../src/modules/devices/device-registry.ts";
import { createSecretStore } from "../src/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

async function secretStore() {
  const dir = await mkdtemp(join(tmpdir(), "solyx-devices-"));

  return createSecretStore(join(dir, "secrets.json"), fakeCipher().cipher);
}

test("a paired device is known by its token, which is kept only as a hash", async () => {
  const secrets = await secretStore();
  const registry = createDeviceRegistry(secrets);

  const { token, device } = await registry.pair("Phone");

  expect(registry.verify(token)).toEqual(device);
  expect(registry.verify(`${token}x`)).toBeNull();
  expect(await secrets.get("paired-devices")).not.toContain(token);
});

test("devices are sealed with the secrets, so a new registry over them knows each", async () => {
  const secrets = await secretStore();
  const { token, device } = await createDeviceRegistry(secrets).pair("Laptop");

  const reopened = createDeviceRegistry(secrets);

  await expect.poll(() => reopened.verify(token)).toEqual(device);
  expect(reopened.list()).toEqual([device]);
});

test("an unpaired device's token no longer reaches anything", async () => {
  const registry = createDeviceRegistry(await secretStore());
  const { token, device } = await registry.pair("Tablet");

  await registry.remove(device.id);

  expect(registry.verify(token)).toBeNull();
  expect(registry.list()).toEqual([]);
});

test("a device removed while another pairs stays removed", async () => {
  const secrets = await secretStore();
  const registry = createDeviceRegistry(secrets);
  const first = await registry.pair("Phone");

  const [, second] = await Promise.all([
    registry.remove(first.device.id),
    registry.pair("Tablet"),
  ]);

  expect(registry.list()).toEqual([second.device]);
  expect(registry.verify(first.token)).toBeNull();

  const reopened = createDeviceRegistry(secrets);

  await expect.poll(() => reopened.list()).toEqual([second.device]);
});
