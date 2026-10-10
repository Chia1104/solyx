import { noop } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import enUS from "@solyx/i18n/desktop/en-US.json" with { type: "json" };
import zhTW from "@solyx/i18n/desktop/zh-TW.json" with { type: "json" };

import { clock } from "#shared/clock.ts";
import { Locale } from "#shared/ipc/settings.ts";
import { UpdateStatus } from "#shared/ipc/updates.ts";
import { DestinationKind } from "#shared/ipc/workspace.ts";
import type { Destination } from "#shared/ipc/workspace.ts";
import { SettingsSection } from "#shared/settings-section.ts";

import { createTray } from "../src/main/modules/tray/tray.ts";
import type {
  TrayShell,
  TrayState,
  TrayView,
} from "../src/main/modules/tray/tray.ts";

const TIME_ZONE = "Asia/Taipei";

const HOUR_MS = 60 * 60 * 1000;

const idle = (): TrayState => ({
  mode: BrokerMode.Paper,
  proposals: 0,
  approvals: [],
  tasks: [],
  update: { status: UpdateStatus.Idle },
});

/** What a test changes between syncs. */
interface App {
  locale: Locale;
  state: TrayState;
}

function setup({ dock = true }: { dock?: boolean } = {}) {
  const settings = { show: true, hideDock: false };
  const windows = { open: true };
  const app: App = { locale: Locale.EnUS, state: idle() };

  const shell = {
    hasWindows: () => windows.open,
    quit: vi.fn<() => void>(),
    show: vi.fn<(view: TrayView) => void>(),
    hide: vi.fn<() => void>(),
    dock: dock
      ? { setVisible: vi.fn<(visible: boolean) => void>() }
      : undefined,
  } satisfies TrayShell;

  const open = vi.fn<(destination?: Destination) => void>();
  const installUpdate = vi.fn<() => void>();
  const diagnostics = { recovered: vi.fn(), report: vi.fn() };
  const readState = vi.fn(async () => app.state);

  const tray = createTray({
    settings: () => settings,
    locale: () => app.locale,
    timeZone: () => TIME_ZONE,
    state: readState,
    open,
    installUpdate,
    shell,
    diagnostics,
  });

  /** The view the icon shows now. */
  const view = () => shell.show.mock.lastCall?.[0];

  const labels = () => view()?.rows.map((row) => row?.label);

  /** Picks the row that reads `label`. */
  const select = (label: string) =>
    view()
      ?.rows.find((row) => row?.label === label)
      ?.select?.();

  return {
    tray,
    shell,
    settings,
    windows,
    app,
    open,
    installUpdate,
    diagnostics,
    readState,
    view,
    labels,
    select,
  };
}

test("the menu names the account, opens the window and quits the app, in the language the app shows", async () => {
  const { tray, shell, app, open, labels, select } = setup();

  await tray.sync();

  expect(labels()).toEqual([
    enUS["broker-mode"].paper,
    undefined,
    enUS.tray.open,
    undefined,
    enUS.tray.quit,
  ]);

  select(enUS["broker-mode"].paper);
  select(enUS.tray.open);
  select(enUS.tray.quit);

  expect(open).toHaveBeenCalledExactlyOnceWith();
  expect(shell.quit).toHaveBeenCalledOnce();

  app.locale = Locale.ZhTW;
  await tray.sync();

  expect(labels()).toEqual([
    zhTW["broker-mode"].paper,
    undefined,
    zhTW.tray.open,
    undefined,
    zhTW.tray.quit,
  ]);
});

test("what waits for the user is listed and counted, and each row opens the window at it", async () => {
  const { tray, app, open, view, labels, select } = setup();

  app.state = {
    ...idle(),
    proposals: 2,
    approvals: [
      { sessionId: "s1", title: "Morning brief" },
      { sessionId: "s2", title: "" },
    ],
  };
  await tray.sync();

  expect(labels()).toEqual([
    "Paper trading",
    undefined,
    "Waiting for you",
    "2 proposals to confirm",
    "Morning brief: a call to allow",
    "New conversation: a call to allow",
    undefined,
    "Open Solyx",
    undefined,
    "Quit Solyx",
  ]);
  expect(view()).toMatchObject({ waiting: 4, hint: "4 waiting for you" });

  select("Waiting for you");

  expect(open).not.toHaveBeenCalled();

  select("2 proposals to confirm");

  expect(open).toHaveBeenLastCalledWith({ kind: DestinationKind.Proposals });

  select("New conversation: a call to allow");

  expect(open).toHaveBeenLastCalledWith({
    kind: DestinationKind.Conversation,
    sessionId: "s2",
  });

  app.state = { ...idle(), proposals: 1 };
  await tray.sync();

  expect(labels()).toContain("1 proposal to confirm");
  expect(view()).toMatchObject({ waiting: 1, hint: "1 waiting for you" });

  app.state = idle();
  await tray.sync();

  expect(view()).toMatchObject({ waiting: 0, hint: undefined });
});

test("scheduled tasks list those running, then the next few on the user's clock", async () => {
  const { tray, app, open, labels, select } = setup();
  const now = Date.now();
  const { time } = clock(Locale.EnUS, TIME_ZONE);

  const next = (name: string, hours: number) => ({
    name,
    running: false,
    nextRunAt: now + hours * HOUR_MS,
    sessionId: null,
  });

  app.state = {
    ...idle(),
    approvals: [{ sessionId: "asking", title: "Close review" }],
    tasks: [
      next("Fourth", 4),
      next("Second", 2),
      { name: "Brief", running: true, nextRunAt: null, sessionId: "brief" },
      // Its run waits for the user, so it is listed under what waits alone.
      {
        name: "Close review",
        running: true,
        nextRunAt: null,
        sessionId: "asking",
      },
      next("First", 1),
      next("Third", 3),
      {
        name: "Waits on a change",
        running: false,
        nextRunAt: null,
        sessionId: null,
      },
    ],
  };
  await tray.sync();

  expect(labels()?.slice(5, 10)).toEqual([
    "Scheduled tasks",
    "Brief · running",
    `First · ${time(now + HOUR_MS)}`,
    `Second · ${time(now + 2 * HOUR_MS)}`,
    `Third · ${time(now + 3 * HOUR_MS)}`,
  ]);

  select("Brief · running");

  expect(open).toHaveBeenLastCalledWith({
    kind: DestinationKind.Conversation,
    sessionId: "brief",
  });

  select(`First · ${time(now + HOUR_MS)}`);

  expect(open).toHaveBeenLastCalledWith({
    kind: DestinationKind.Settings,
    section: SettingsSection.Schedules,
  });
});

test("a name too long for the menu is cut short", async () => {
  const { tray, app, labels } = setup();

  app.state = {
    ...idle(),
    tasks: [
      { name: "x".repeat(60), running: true, nextRunAt: null, sessionId: null },
    ],
  };
  await tray.sync();

  expect(labels()).toContain(`${"x".repeat(39)}… · running`);
});

test("a downloaded update installs from the menu, and one to download opens About", async () => {
  const { tray, app, open, installUpdate, select } = setup();

  app.state = {
    ...idle(),
    update: { status: UpdateStatus.Ready, version: "1.2.0" },
  };
  await tray.sync();
  select("Restart to update to 1.2.0");

  expect(installUpdate).toHaveBeenCalledOnce();

  app.state = {
    ...idle(),
    update: {
      status: UpdateStatus.Available,
      version: "1.3.0",
      url: "https://example.test/v1.3.0",
    },
  };
  await tray.sync();
  select("Solyx 1.3.0 is available");

  expect(open).toHaveBeenLastCalledWith({
    kind: DestinationKind.Settings,
    section: SettingsSection.About,
  });
});

test("the menu is replaced only when what it shows changed", async () => {
  const { tray, shell, app } = setup();

  await tray.sync();
  await tray.sync();

  // Once before the rest of the app was read, and once with it.
  expect(shell.show).toHaveBeenCalledTimes(2);

  app.state = { ...idle(), proposals: 1 };
  await tray.sync();

  expect(shell.show).toHaveBeenCalledTimes(3);
});

test("the newest read is the one shown, however late an older one comes back", async () => {
  const { tray, readState, view } = setup();
  let finishOlder: (state: TrayState) => void = noop;

  const older = new Promise<TrayState>((resolve) => {
    finishOlder = resolve;
  });

  readState.mockImplementationOnce(() => older);

  const first = tray.sync();

  readState.mockImplementationOnce(async () => ({ ...idle(), proposals: 2 }));
  await tray.sync();

  finishOlder({ ...idle(), proposals: 5 });
  await first;

  expect(view()).toMatchObject({ waiting: 2 });
});

test("a read that fails is reported and leaves the menu as it was", async () => {
  const { tray, readState, diagnostics, labels } = setup();
  const failure = new Error("agent store closed");

  readState.mockRejectedValueOnce(failure);
  await tray.sync();

  expect(diagnostics.report).toHaveBeenCalledExactlyOnceWith(
    failure,
    "tray.state"
  );
  expect(labels()).toEqual(["Open Solyx", undefined, "Quit Solyx"]);
});

test("the app stays open in the tray without a window until the icon is switched off", async () => {
  const { tray, shell, settings, readState } = setup({ dock: false });

  expect(tray.staysOpen()).toBe(false);

  await tray.sync();

  expect(tray.staysOpen()).toBe(true);

  settings.show = false;
  await tray.sync();

  expect(shell.hide).toHaveBeenCalledOnce();
  expect(tray.staysOpen()).toBe(false);
  // Nothing is read for a menu nobody can open.
  expect(readState).toHaveBeenCalledOnce();
});

test("a computer with a Dock keeps the app open there without the icon", async () => {
  const { tray, shell, settings } = setup();

  settings.show = false;
  await tray.sync();

  expect(shell.show).not.toHaveBeenCalled();
  expect(shell.hide).not.toHaveBeenCalled();
  expect(tray.staysOpen()).toBe(true);
});

test("the app leaves the Dock only while no window is open and the icon is there to bring it back", async () => {
  const { tray, shell, settings, windows } = setup();

  settings.hideDock = true;
  await tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(true);

  windows.open = false;
  await tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(false);

  windows.open = true;
  await tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(true);

  windows.open = false;
  settings.show = false;
  await tray.sync();

  expect(shell.dock?.setVisible).toHaveBeenLastCalledWith(true);
});

test("the icon goes as the app quits", async () => {
  const { tray, shell } = setup();

  tray.close();

  expect(shell.hide).not.toHaveBeenCalled();

  await tray.sync();
  tray.close();

  expect(shell.hide).toHaveBeenCalledOnce();
});
