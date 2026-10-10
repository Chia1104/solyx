import * as z from "zod";

import { workspaceChannels } from "#shared/ipc/workspace.ts";
import type { WorkspaceApi } from "#shared/ipc/workspace.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  takeDestination: z.tuple([]),
};

export function registerWorkspaceIpc({ workspace }: Services) {
  bindIpc<WorkspaceApi>(workspaceChannels, schemas, {
    takeDestination: async () => workspace.takeDestination(),
  });
}
