import { expect, test, vi } from "vite-plus/test";

import { createTray } from "../src/main/modules/tray/tray.ts";
import type { TrayRow, TrayShell } from "../src/main/modules/tray/tray.ts";

function setup({ dock = true }: { dock?: boolean } = {}) {
  const settings = { show: true, hideDock: false };
  const copy = { open: "Open Solyx", quit: "Quit Solyx" };
  const windows = { open: true };

  const shell = {
    hasWindows: () => windows.open,
    openWindow: vi.fn<() => void>(),
    quit: vi.fn<() => void>(),
    show: vi.fn<(rows: TrayRow[]) => void>(),
    hide: vi.fn<() => void>(),
    dock: dock
      ? { setVisible: vi.fn<(visible: boolean) => void>() }
      : undefined,
  } satisfies TrayShell;

  const tray = createTray({
    settings: () => settings,
    copy: () => copy,
    shell,
  });

  return { tray, shell, settings, copy, windows };
}

const labels = (rows: TrayRow[] | undefined) => rows?.map((row) => row?.label);

test("the icon's menu opens the window and quits the app, in the language the app shows", () => {
  const { tray, shell, copy } = setup();

  tray.sync();

  const [rows] = shell.show.mock.lastCall ?? [];

  expect(labels(rows)).toEqual(["Open Solyx", undefined, "Quit Solyx"]);

  rows?.at(0)?.select();
  rows?.at(-1)?.select();

  expect(shell.openWindow).toHaveBeenCalledOnce();
  expect(shell.quit).toHaveBeenCalledOnce();

  copy.open = "開啟 Solyx";
  copy.quit = "結束 Solyx";
  tray.sync();

  expect(labels(shell.show.mock.lastCall?.[0])).toEqual([
    "開啟 Solyx",
    undefined,
    "結束 Solyx",
  ]);
});

test("the app stays open in the tray without a window until the icon is switched off", () => {
  const { tray, shell, settings } = setup({ dock: false });

  expect(tray.staysOpen()).toBe(false);

  tray.sync();

  expect(tray.staysOpen()).toBe(true);

  settings.show = false;
  tray.sync();

  expect(shell.hide).toHaveBeenCalledOnce();
  expect(tray.staysOpen()).toBe(false);
});

test("a computer with a Dock keeps the app open there without the icon", () => {
  const { tray, shell, settings } = setup();

  settings.show = false;
  tray.sync();

  expect(shell.show).not.toHaveBeenCalled();
  expect(shell.hide).not.toHaveBeenCalled();
  expect(tray.staysOpen()).toBe(true);
});

test("the app leaves the Dock only while no window is open and the icon is there to bring it back", () => {
  const { tray, shell, settings, windows } = setup();

  settings.hideDock = true;
  tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(true);

  windows.open = false;
  tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(false);

  windows.open = true;
  tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(true);

  windows.open = false;
  settings.show = false;
  tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(true);
});

test("the icon goes as the app quits", () => {
  const { tray, shell } = setup();

  tray.close();

  expect(shell.hide).not.toHaveBeenCalled();

  tray.sync();
  tray.close();

  expect(shell.hide).toHaveBeenCalledOnce();
});
