import { expect, test, vi } from "vite-plus/test";

import { DestinationKind } from "#shared/ipc/workspace.ts";
import type { Destination } from "#shared/ipc/workspace.ts";

import { createWorkspace } from "../src/main/modules/workspace/workspace.ts";

function setup() {
  const showWindow = vi.fn<() => void>();
  const onDestination = vi.fn<() => void>();

  return {
    workspace: createWorkspace({ showWindow, onDestination }),
    showWindow,
    onDestination,
  };
}

const proposals: Destination = { kind: DestinationKind.Proposals };

test("a destination brings the window forward and is handed to the first window that asks, once", () => {
  const { workspace, showWindow, onDestination } = setup();

  workspace.open(proposals);

  expect(showWindow).toHaveBeenCalledOnce();
  expect(onDestination).toHaveBeenCalledOnce();
  expect(workspace.takeDestination()).toEqual(proposals);
  expect(workspace.takeDestination()).toBeNull();
});

test("opening the window with nowhere to go leaves a destination that still waits", () => {
  const { workspace, showWindow, onDestination } = setup();

  workspace.open();

  expect(showWindow).toHaveBeenCalledOnce();
  expect(onDestination).not.toHaveBeenCalled();
  expect(workspace.takeDestination()).toBeNull();

  workspace.open(proposals);
  workspace.open();

  expect(workspace.takeDestination()).toEqual(proposals);
});

test("a newer destination replaces one no window took", () => {
  const { workspace } = setup();

  const conversation: Destination = {
    kind: DestinationKind.Conversation,
    sessionId: "s1",
  };

  workspace.open(proposals);
  workspace.open(conversation);

  expect(workspace.takeDestination()).toEqual(conversation);
});
