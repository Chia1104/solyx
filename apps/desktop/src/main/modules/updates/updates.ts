import { errorMessage } from "@solyx/utils/error";

import { UpdateStatus } from "#shared/ipc/updates.ts";
import type { UpdateState } from "#shared/ipc/updates.ts";

const RELEASES_URL = "https://github.com/Chia1104/solyx/releases/tag";

const HOUR_MS = 60 * 60 * 1000;

const CHECK_EVERY_MS = 6 * HOUR_MS;

// Short enough that switching checks on is followed by one soon after.
const PASS_EVERY_MS = 30 * 60 * 1000;

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
  /** Read before every pass, so a changed setting applies without a restart. */
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

  return {
    state: () => state,

    check,

    install() {
      if (state.status === UpdateStatus.Ready) updater?.install();
    },

    everyMs: PASS_EVERY_MS,

    /** Checks while the user has checks on and the last was long enough ago. */
    async run() {
      if (checkEnabled() && Date.now() - checkedAt >= CHECK_EVERY_MS)
        await check();
    },
  };
}

export type Updates = ReturnType<typeof createUpdates>;
