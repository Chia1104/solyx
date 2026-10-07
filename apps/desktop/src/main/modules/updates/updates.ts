import { errorMessage } from "@solyx/utils/error";

import { UpdateStatus } from "#shared/ipc/updates.ts";
import type { UpdateState } from "#shared/ipc/updates.ts";

const RELEASES_URL = "https://github.com/Chia1104/solyx/releases/tag";

const HOUR_MS = 60 * 60 * 1000;

const CHECK_EVERY_MS = 6 * HOUR_MS;

// Short enough that switching checks on is followed by one soon after.
const TICK_MS = 30 * 60 * 1000;

// Lets the app finish starting before the first check.
const FIRST_TICK_MS = 60 * 1000;

/** The update feed of the channel the app was built for. */
export interface Updater {
  /** Whether it downloads and installs updates itself; macOS cannot without a Developer ID. */
  installs: boolean;
  /** The newer version the feed offers, or `null` when the running one is the newest. */
  check(): Promise<string | null>;
  download(): Promise<void>;
  /** Quits the app and installs what `download` fetched. */
  install(): void;
}

export interface UpdatesOptions {
  /** `null` where the app cannot update. */
  updater: Updater | null;
  /** Read before every scheduled check, so a changed setting applies without a restart. */
  checkEnabled: () => boolean;
  onChange: () => void;
}

/** Checks for a newer Solyx while the app runs: downloads it where the app installs it, or else links to it. */
export function createUpdates({
  updater,
  checkEnabled,
  onChange,
}: UpdatesOptions) {
  let state: UpdateState = {
    status: updater ? UpdateStatus.Idle : UpdateStatus.Unsupported,
  };

  let checkedAt = 0;
  let timers: NodeJS.Timeout[] = [];

  function set(next: UpdateState) {
    state = next;
    onChange();
  }

  async function check() {
    // A downloaded update stays the one to install; checking again would download it again.
    if (
      !updater ||
      state.status === UpdateStatus.Checking ||
      state.status === UpdateStatus.Downloading ||
      state.status === UpdateStatus.Ready
    )
      return;

    checkedAt = Date.now();
    set({ status: UpdateStatus.Checking });

    try {
      const version = await updater.check();

      if (version === null) {
        set({ status: UpdateStatus.Current });
      } else if (updater.installs) {
        set({ status: UpdateStatus.Downloading, version });
        await updater.download();
        set({ status: UpdateStatus.Ready, version });
      } else {
        set({
          status: UpdateStatus.Available,
          version,
          url: `${RELEASES_URL}/v${version}`,
        });
      }
    } catch (error) {
      set({ status: UpdateStatus.Failed, error: errorMessage(error) });
    }
  }

  function tick() {
    if (checkEnabled() && Date.now() - checkedAt >= CHECK_EVERY_MS)
      void check();
  }

  return {
    state: () => state,

    check,

    install() {
      if (state.status === UpdateStatus.Ready) updater?.install();
    },

    start() {
      if (!updater) return;

      timers = [setTimeout(tick, FIRST_TICK_MS), setInterval(tick, TICK_MS)];
    },

    stop() {
      for (const timer of timers) clearTimeout(timer);

      timers = [];
    },
  };
}

export type Updates = ReturnType<typeof createUpdates>;
