import * as z from "zod";

import {
  CollectionJob,
  collectionPlanSchema,
  scheduledTaskDraftSchema,
} from "@solyx/core/schedule";

import { schedulesChannels } from "#shared/ipc/schedules.ts";
import type { SchedulesApi } from "#shared/ipc/schedules.ts";
import { localeSchema } from "#shared/ipc/settings.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

// A run answers in one of the app's own languages, as a message the user sends does.
const draftSchema = scheduledTaskDraftSchema.extend({ locale: localeSchema });

const id = z.string().min(1);

const job = z.enum(CollectionJob);

const schemas = {
  collections: z.tuple([]),
  setCollection: z.tuple([job, collectionPlanSchema]),
  collectNow: z.tuple([job]),
  list: z.tuple([]),
  create: z.tuple([draftSchema]),
  update: z.tuple([id, draftSchema]),
  remove: z.tuple([id]),
  runNow: z.tuple([id]),
};

export function registerSchedulesIpc({ schedules, collections }: Services) {
  bindIpc<SchedulesApi>(schedulesChannels, schemas, {
    collections: () => collections.list(),
    setCollection: async (which, plan) => collections.set(which, plan),
    collectNow: (which) => collections.collectNow(which),
    list: () => schedules.list(),
    create: async (draft) => schedules.create(draft),
    update: async (taskId, draft) => schedules.update(taskId, draft),
    remove: async (taskId) => schedules.remove(taskId),
    runNow: (taskId) => schedules.runNow(taskId),
  });
}
