import { expect, test, vi } from "vite-plus/test";

import { createUpdates } from "../src/main/modules/updates/updates.ts";
import type { Updater } from "../src/main/modules/updates/updates.ts";
import { UpdateStatus } from "../src/shared/ipc/updates.ts";

function setup(updater: Partial<Updater> & Pick<Updater, "installs">) {
  const install = vi.fn();
  const onChange = vi.fn();

  const updates = createUpdates({
    updater: {
      check: async () => "1.2.0",
      download: async () => undefined,
      install,
      ...updater,
    },
    checkEnabled: () => true,
    onChange,
  });

  return { updates, install, onChange };
}

test("an app that installs updates downloads the newer version and installs it on request", async () => {
  const { updates, install, onChange } = setup({ installs: true });

  await updates.check();

  expect(updates.state()).toEqual({
    status: UpdateStatus.Ready,
    version: "1.2.0",
  });
  expect(onChange).toHaveBeenCalledTimes(3);

  updates.install();

  expect(install).toHaveBeenCalledOnce();
});

test("an app that cannot install updates links to the newer version's release", async () => {
  const download = vi.fn(async () => undefined);
  const { updates, install } = setup({ installs: false, download });

  await updates.check();
  updates.install();

  expect(updates.state()).toEqual({
    status: UpdateStatus.Available,
    version: "1.2.0",
    url: "https://github.com/Chia1104/solyx/releases/tag/v1.2.0",
  });
  expect(download).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
});

test("the newest version running is current", async () => {
  const { updates } = setup({ installs: true, check: async () => null });

  await updates.check();

  expect(updates.state()).toEqual({ status: UpdateStatus.Current });
});

test("a failed check keeps its error", async () => {
  const { updates } = setup({
    installs: true,
    check: () => Promise.reject(new Error("offline")),
  });

  await updates.check();

  expect(updates.state()).toEqual({
    status: UpdateStatus.Failed,
    error: "offline",
  });
});

test("a downloaded update is not checked for again", async () => {
  const check = vi.fn(async () => "1.2.0");
  const { updates } = setup({ installs: true, check });

  await updates.check();
  await updates.check();

  expect(check).toHaveBeenCalledOnce();
});

test("an app that cannot update never checks", async () => {
  const updates = createUpdates({
    updater: null,
    checkEnabled: () => true,
    onChange: vi.fn(),
  });

  await updates.check();

  expect(updates.state()).toEqual({ status: UpdateStatus.Unsupported });
});
