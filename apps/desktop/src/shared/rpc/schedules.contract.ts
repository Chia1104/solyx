import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { CollectionJob, collectionPlanSchema } from "@solyx/core/schedule";

import { taskDraftSchema } from "../schedules.ts";
import type { CollectionView, ScheduledTaskView } from "../schedules.ts";

import { changesContract } from "./changes.ts";

const idSchema = z.string().min(1);

const jobSchema = z.enum(CollectionJob);

export const schedulesContract = {
  /** What the app collects on its own, in a fixed order. */
  collections: oc.output(type<CollectionView[]>()),
  setCollection: oc
    .input(z.object({ job: jobSchema, plan: collectionPlanSchema }))
    .output(type<void>()),
  /** Collects now, whatever its plan says, and resolves once it is done. */
  collectNow: oc.input(jobSchema).output(type<void>()),
  /** Oldest first. */
  list: oc.output(type<ScheduledTaskView[]>()),
  create: oc.input(taskDraftSchema).output(type<void>()),
  /** Saves the task again, so its next run counts from now. */
  update: oc
    .input(z.object({ id: idSchema, draft: taskDraftSchema }))
    .output(type<void>()),
  remove: oc.input(idSchema).output(type<void>()),
  /** Starts a run now, whatever its schedule says; refused while its last run is still going. */
  runNow: oc.input(idSchema).output(type<void>()),
  /** A task was saved or removed, or one of them ran, or a collection's plan changed. */
  changes: changesContract,
};
