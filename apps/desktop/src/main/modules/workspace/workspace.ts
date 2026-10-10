import type { Destination } from "#shared/ipc/workspace.ts";

export interface WorkspaceOptions {
  /** Brings the app's window to the front, opening one when none is. */
  showWindow: () => void;
  /** Tells every window a destination waits to be taken. */
  onDestination: () => void;
}

/** The way from outside the window, such as the tray's menu, to a place in it. */
export function createWorkspace({
  showWindow,
  onDestination,
}: WorkspaceOptions) {
  let waiting: Destination | null = null;

  return {
    /** Brings the window forward, at `destination` when one is named. */
    open(destination?: Destination) {
      if (destination) waiting = destination;

      showWindow();

      // A window still loading misses this, and takes the destination once it has loaded.
      if (destination) onDestination();
    },

    /** Hands the destination over once, to the first window that asks. */
    takeDestination(): Destination | null {
      const destination = waiting;

      waiting = null;

      return destination;
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
