import { expect, test } from "vite-plus/test";

import { refusesRemoteDebugging } from "../src/main/shell/remote-debugging.ts";
import { AppChannel } from "../src/shared/app-channel.ts";

function commandLine(...switches: string[]) {
  return { hasSwitch: (name: string) => switches.includes(name) };
}

test("stable and nightly builds refuse the DevTools protocol on a port or on pipes", () => {
  for (const channel of [AppChannel.Stable, AppChannel.Nightly]) {
    expect(
      refusesRemoteDebugging(channel, commandLine("remote-debugging-port"))
    ).toBe(true);
    expect(
      refusesRemoteDebugging(channel, commandLine("remote-debugging-pipe"))
    ).toBe(true);
    expect(refusesRemoteDebugging(channel, commandLine("lang"))).toBe(false);
  }
});

test("a development run and the test package accept remote debugging", () => {
  const asked = commandLine("remote-debugging-port", "remote-debugging-pipe");

  expect(refusesRemoteDebugging(AppChannel.Development, asked)).toBe(false);
  expect(refusesRemoteDebugging(AppChannel.Test, asked)).toBe(false);
});
