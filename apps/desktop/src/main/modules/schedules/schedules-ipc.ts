import * as z from "zod";

import { scheduledTaskDraftSchema } from "@solyx/core/schedule";

import { schedulesChannels } from "#shared/ipc/schedules.ts";
import type { SchedulesApi } from "#shared/ipc/schedules.ts";
import { localeSchema } from "#shared/ipc/settings.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

// A run answers in one of the app's own languages, as a message the user sends does.
const draftSchema = scheduledTaskDraftSchema.extend({ locale: localeSchema });

const id = z.string().min(1);

const schemas = {
  list: z.tuple([]),
  create: z.tuple([draftSchema]),
  update: z.tuple([id, draftSchema]),
  remove: z.tuple([id]),
  runNow: z.tuple([id]),
};

export function registerSchedulesIpc({ schedules }: Services) {
  bindIpc<SchedulesApi>(schedulesChannels, schemas, {
    list: () => schedules.list(),
    create: async (draft) => schedules.create(draft),
    update: async (taskId, draft) => schedules.update(taskId, draft),
    remove: async (taskId) => schedules.remove(taskId),
    runNow: (taskId) => schedules.runNow(taskId),
  });
}
