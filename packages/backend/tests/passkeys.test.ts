import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vite-plus/test";

import { SignedActionKind } from "@solyx/api/devices";

import { createDeviceRegistry } from "../src/modules/devices/device-registry.ts";
import { createPasskeys } from "../src/modules/devices/passkeys.ts";
import { createSecretStore } from "../src/modules/settings/secret-store.ts";
import { ClientKind } from "../src/rpc/context.ts";
import type { DeviceClient } from "../src/rpc/context.ts";

import { fakeCipher } from "./fake-cipher.ts";
import { softwarePasskey } from "./software-passkey.ts";

const ORIGIN = "http://localhost:18321";

afterEach(() => {
  vi.useRealTimers();
});

/** A registry with one browser just paired, the passkeys over it and that browser as a client. */
async function paired() {
  const dir = await mkdtemp(join(tmpdir(), "solyx-passkeys-"));

  const secrets = createSecretStore(
    join(dir, "secrets.json"),
    fakeCipher().cipher
  );

  const registry = createDeviceRegistry(secrets);
  const passkeys = createPasskeys(registry, vi.fn());
  const { device } = await registry.pair("Phone");

  passkeys.paired(device.id);

  const phone: DeviceClient = {
    kind: ClientKind.Device,
    device: device.id,
    origin: ORIGIN,
  };

  return { registry, passkeys, phone, secrets };
}

/** `paired`, with the browser's passkey added. */
async function signing() {
  const setup = await paired();
  const key = softwarePasskey(ORIGIN);

  await setup.passkeys.addPasskey(
    setup.phone,
    key.register(await setup.passkeys.passkeyOptions(setup.phone))
  );

  return { ...setup, key };
}

test("a browser that adds a passkey as it pairs is shown as one that signs", async () => {
  const { registry, phone } = await signing();

  expect(registry.get(phone.device)).toMatchObject({ signs: true });
});

test("a token alone adds no passkey once the minutes after pairing have passed", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });

  const { passkeys, phone } = await paired();

  vi.setSystemTime(Date.now() + 6 * 60_000);

  await expect(passkeys.passkeyOptions(phone)).rejects.toThrow(
    "pair this one again"
  );
});

test("a browser that has added one adds no other", async () => {
  const { passkeys, phone } = await signing();

  await expect(passkeys.passkeyOptions(phone)).rejects.toThrow(
    "pair this one again"
  );
});

test("a passkey signs the one action it was asked for, and its signature is taken once", async () => {
  const { passkeys, phone, key, registry } = await signing();
  const action = { kind: SignedActionKind.Confirm, id: "p1" };

  const signature = key.sign(await passkeys.actionOptions(phone, action));

  await passkeys.verifyAction(phone, action, signature);

  expect(registry.passkey(phone.device)?.counter).toBe(1);
  await expect(passkeys.verifyAction(phone, action, signature)).rejects.toThrow(
    "Sign this with the browser's passkey first"
  );
});

test("a signature asked for one proposal does not take another", async () => {
  const { passkeys, phone, key } = await signing();

  const signature = key.sign(
    await passkeys.actionOptions(phone, {
      kind: SignedActionKind.Confirm,
      id: "p1",
    })
  );

  await expect(
    passkeys.verifyAction(
      phone,
      { kind: SignedActionKind.Confirm, id: "p2" },
      signature
    )
  ).rejects.toThrow("Sign this with the browser's passkey first");
});

test("a signature made on another page, or by another key, is refused", async () => {
  const { passkeys, phone, key } = await signing();
  const action = { kind: SignedActionKind.CancelOrder, id: "B-1" };

  await expect(
    passkeys.verifyAction(
      phone,
      action,
      key.sign(
        await passkeys.actionOptions(phone, action),
        "http://localhost:9999"
      )
    )
  ).rejects.toThrow();

  await expect(
    passkeys.verifyAction(
      phone,
      action,
      softwarePasskey(ORIGIN).sign(await passkeys.actionOptions(phone, action))
    )
  ).rejects.toThrow();
});

test("a signature not sent within minutes of being asked for is refused", async () => {
  const { passkeys, phone, key } = await signing();
  const action = { kind: SignedActionKind.CancelExit, id: "p1" };

  vi.useFakeTimers({ toFake: ["Date"] });

  const signature = key.sign(await passkeys.actionOptions(phone, action));

  vi.setSystemTime(Date.now() + 3 * 60_000);

  await expect(passkeys.verifyAction(phone, action, signature)).rejects.toThrow(
    "Sign this with the browser's passkey first"
  );
});

test("a passkey is bound to localhost, since browsers bind none to an IP address", async () => {
  const { passkeys, phone } = await paired();

  await expect(
    passkeys.passkeyOptions({ ...phone, origin: "http://127.0.0.1:18321" })
  ).rejects.toThrow("only at http://localhost");
});

test("the passkey is sealed with the secrets, without the token", async () => {
  const { secrets, registry, phone } = await signing();

  const sealed = await secrets.get("paired-devices");

  expect(sealed).toContain(registry.passkey(phone.device)?.publicKey);
});

test("what a browser signed is not taken once it is unpaired", async () => {
  const { passkeys, phone, key, registry } = await signing();
  const action = { kind: SignedActionKind.Confirm, id: "p1" };

  const signature = key.sign(await passkeys.actionOptions(phone, action));

  await registry.remove(phone.device);

  await expect(
    passkeys.verifyAction(phone, action, signature)
  ).rejects.toThrow();
  expect(registry.list()).toEqual([]);
});

test("a count kept as a browser is unpaired does not bring it back", async () => {
  const { phone, registry } = await signing();
  const passkey = registry.passkey(phone.device);

  if (!passkey) throw new Error("No passkey");

  const [, kept] = await Promise.allSettled([
    registry.remove(phone.device),
    registry.setPasskey(phone.device, { ...passkey, counter: 5 }),
  ]);

  expect(kept).toMatchObject({ status: "rejected" });
  expect(registry.list()).toEqual([]);
});
