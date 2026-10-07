export const UpdateStatus = {
  /** Development builds and Linux, which have no installer to update from. */
  Unsupported: "unsupported",
  /** Not checked since the app started. */
  Idle: "idle",
  Checking: "checking",
  /** The newest version is running. */
  Current: "current",
  Downloading: "downloading",
  /** Downloaded; it installs when the app restarts or quits. */
  Ready: "ready",
  /** Newer than the running version, for the user to download, since the app cannot install it itself. */
  Available: "available",
  Failed: "failed",
} as const;

export type UpdateStatus = (typeof UpdateStatus)[keyof typeof UpdateStatus];

export type UpdateState =
  | {
      status:
        | typeof UpdateStatus.Unsupported
        | typeof UpdateStatus.Idle
        | typeof UpdateStatus.Checking
        | typeof UpdateStatus.Current;
    }
  | {
      status: typeof UpdateStatus.Downloading | typeof UpdateStatus.Ready;
      version: string;
    }
  | {
      status: typeof UpdateStatus.Available;
      version: string;
      /** The version's release page, which carries its installer. */
      url: string;
    }
  | { status: typeof UpdateStatus.Failed; error: string };

export interface UpdatesApi {
  state(): Promise<UpdateState>;
  /** Checks now, whether or not scheduled checks are on. */
  check(): Promise<void>;
  /** Quits and installs the downloaded update, which restarts the app. */
  install(): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface UpdatesEvents {
  onChanged(listener: () => void): () => void;
}

export const updatesChannels = {
  state: "updates:state",
  check: "updates:check",
  install: "updates:install",
} as const satisfies Record<keyof UpdatesApi, string>;

export const updatesEvents = {
  onChanged: "updates:changed",
} as const satisfies Record<keyof UpdatesEvents, string>;
