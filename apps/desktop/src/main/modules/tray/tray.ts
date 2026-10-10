import type { BrokerMode } from "@solyx/core/broker";

import { clock } from "#shared/clock.ts";
import type { Locale, TimeZone } from "#shared/ipc/settings.ts";
import { UpdateStatus } from "#shared/ipc/updates.ts";
import type { UpdateState } from "#shared/ipc/updates.ts";
import { DestinationKind } from "#shared/ipc/workspace.ts";
import type { Destination } from "#shared/ipc/workspace.ts";
import { SettingsSection } from "#shared/settings-section.ts";

import { CATALOGS, fill, plural } from "../settings/catalogs.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

/**
 * One row of the tray's menu: one that does something, a heading with nothing to `select`, or
 * `null` for a rule between groups.
 */
export type TrayRow = { label: string; select?: () => void } | null;

export interface TrayView {
  rows: TrayRow[];
  /** How many things wait for the user. */
  waiting: number;
  /** What hovering the icon says of them; absent while nothing waits. */
  hint?: string;
}

/** What only Electron does for the tray. */
export interface TrayShell {
  hasWindows(): boolean;
  quit(): void;
  /** Puts the icon in the tray showing `view`, or gives the icon there that view. */
  show(view: TrayView): void;
  /** Takes the icon out of the tray. */
  hide(): void;
  /** The Dock, where the computer has one. */
  dock?: { setVisible(visible: boolean): void };
}

/** A scheduled task as the menu lists it. */
export interface TrayTask {
  name: string;
  running: boolean;
  /** Epoch ms of its next run; `null` while none is ahead. */
  nextRunAt: number | null;
  /** The conversation of its last run; `null` when it has not run or could not start. */
  sessionId: string | null;
}

/** What the menu lists of the rest of the app. */
export interface TrayState {
  mode: BrokerMode;
  /** Proposals waiting for the user to confirm them. */
  proposals: number;
  /** Conversations with a call waiting for the user to allow it. */
  approvals: { sessionId: string; title: string }[];
  tasks: TrayTask[];
  update: UpdateState;
}

export interface TrayOptions {
  /** Read afresh at every `sync`. */
  settings: () => { show: boolean; hideDock: boolean };
  /** The language the app shows, which the menu is written in. */
  locale: () => Locale;
  /** The user's own clock, which a task's next run is told on. */
  timeZone: () => TimeZone;
  state: () => Promise<TrayState>;
  /** Brings the app's window to the front, at `destination` when one is named. */
  open: (destination?: Destination) => void;
  /** Quits the app and installs the update it downloaded. */
  installUpdate: () => void;
  shell: TrayShell;
  diagnostics: Diagnostics;
}

/** How many tasks yet to run the menu lists, soonest first. */
const UPCOMING_TASKS = 3;

/** A conversation's title or a task's name in the menu, which has no room for a long one. */
const NAME_LENGTH = 40;

const short = (name: string) =>
  name.length > NAME_LENGTH ? `${name.slice(0, NAME_LENGTH - 1)}…` : name;

/**
 * The app's icon in the menu bar or the system tray, where the app stays open once its last
 * window closes, so the clock's work goes on with somewhere to bring the window back from. Its
 * menu lists what waits for the user and what the app does next, and opens the window at each:
 * it never confirms a proposal or allows a call itself.
 */
export function createTray({
  settings,
  locale,
  timeZone,
  state: readState,
  open,
  installUpdate,
  shell,
  diagnostics,
}: TrayOptions) {
  let shown = false;
  let state: TrayState | undefined;
  /** What the icon last showed, so a menu the user has open is replaced only when it changed. */
  let drawn: string | undefined;
  let reads = 0;

  function view(): TrayView {
    const catalog = CATALOGS[locale()];
    const copy = catalog.tray;
    const groups: Exclude<TrayRow, null>[][] = [];
    const waiting = state ? state.proposals + state.approvals.length : 0;

    if (state) {
      const { mode, proposals, approvals, tasks, update } = state;

      groups.push([{ label: catalog["broker-mode"][mode] }]);

      if (waiting > 0) {
        groups.push([
          { label: copy.waiting },
          ...(proposals > 0
            ? [
                {
                  label: fill(
                    plural(locale(), proposals, {
                      one: copy.proposals_one,
                      other: copy.proposals_other,
                    }),
                    { count: proposals }
                  ),
                  select: () => open({ kind: DestinationKind.Proposals }),
                },
              ]
            : []),
          ...approvals.map(({ sessionId, title }) => ({
            label: fill(copy.approval, {
              title: short(title || catalog.agent.untitled),
            }),
            select: () =>
              open({ kind: DestinationKind.Conversation, sessionId }),
          })),
        ]);
      }

      const asked = new Set(approvals.map((approval) => approval.sessionId));
      const { time } = clock(locale(), timeZone());

      // A run waiting for the user is already listed above, under what waits.
      const running = tasks.filter(
        (task) =>
          task.running &&
          !(task.sessionId !== null && asked.has(task.sessionId))
      );

      const upcoming = tasks
        .flatMap(({ name, running: going, nextRunAt }) =>
          going || nextRunAt === null ? [] : [{ name, nextRunAt }]
        )
        .toSorted((a, b) => a.nextRunAt - b.nextRunAt)
        .slice(0, UPCOMING_TASKS);

      if (running.length + upcoming.length > 0) {
        groups.push([
          { label: copy.tasks },
          ...running.map(({ name, sessionId }) => ({
            label: fill(copy["task-running"], { name: short(name) }),
            select: () =>
              open(
                sessionId === null
                  ? {
                      kind: DestinationKind.Settings,
                      section: SettingsSection.Schedules,
                    }
                  : { kind: DestinationKind.Conversation, sessionId }
              ),
          })),
          ...upcoming.map(({ name, nextRunAt }) => ({
            label: fill(copy["task-next"], {
              name: short(name),
              time: time(nextRunAt),
            }),
            select: () =>
              open({
                kind: DestinationKind.Settings,
                section: SettingsSection.Schedules,
              }),
          })),
        ]);
      }

      if (update.status === UpdateStatus.Ready) {
        groups.push([
          {
            label: fill(copy["update-ready"], { version: update.version }),
            select: installUpdate,
          },
        ]);
      }

      // The app cannot install this one itself, so About links to its release.
      if (update.status === UpdateStatus.Available) {
        groups.push([
          {
            label: fill(copy["update-available"], { version: update.version }),
            select: () =>
              open({
                kind: DestinationKind.Settings,
                section: SettingsSection.About,
              }),
          },
        ]);
      }
    }

    groups.push(
      [{ label: copy.open, select: () => open() }],
      [{ label: copy.quit, select: () => shell.quit() }]
    );

    return {
      rows: groups.flatMap((group, index) =>
        index === 0 ? group : [null, ...group]
      ),
      waiting,
      hint:
        waiting > 0
          ? fill(
              plural(locale(), waiting, {
                one: copy.hint_one,
                other: copy.hint_other,
              }),
              { count: waiting }
            )
          : undefined,
    };
  }

  function draw() {
    const next = view();

    // Rows that read alike may still lead to different places, which the state they came from tells.
    const signature = JSON.stringify([
      next.rows.map((row) => row?.label),
      next.waiting,
      state,
    ]);

    if (signature === drawn) return;

    drawn = signature;
    shell.show(next);
  }

  function hide() {
    if (shown) shell.hide();

    shown = false;
    drawn = undefined;
  }

  return {
    /**
     * Shows what the settings ask for now, then what the rest of the app holds once that is read.
     * Called whenever the settings, the language, the windows or anything the menu lists changes.
     */
    async sync() {
      const { show, hideDock } = settings();

      if (show) {
        shown = true;
        draw();
      } else {
        hide();
      }

      // Out of the Dock only while the icon is there to bring the app back from.
      shell.dock?.setVisible(!(show && hideDock) || shell.hasWindows());

      if (!show) return;

      const read = ++reads;

      try {
        const next = await readState();

        // A later sync read newer state, or the icon went meanwhile.
        if (read !== reads || !shown) return;

        state = next;
        draw();
      } catch (error) {
        diagnostics.report(error, "tray.state");
      }
    },

    /** Whether the app goes on once its last window closes: in the tray, or in the Dock as a macOS app does. */
    staysOpen: () => shown || shell.dock !== undefined,

    /** Takes the icon away as the app quits, since Windows would keep showing it. */
    close: hide,
  };
}

export type Tray = ReturnType<typeof createTray>;
