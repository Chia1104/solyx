import { asyncIteratorObject, oc, type } from "@orpc/contract";
import * as z from "zod";

import { agentModelPickSchema } from "@solyx/agent/providers";
import { agentSessionSetupSchema, approvalModeSchema } from "@solyx/agent/wire";
import type {
  AgentSession,
  AgentWireEvent,
  CompactionOutcome,
} from "@solyx/agent/wire";

import { agentScreenSchema } from "../agent.ts";
import type { AgentUpdate } from "../agent.ts";
import { localeSchema, timeZoneSchema } from "../settings.ts";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

const idSchema = z.string().min(1);

const textSchema = z.string().trim().min(1).max(20_000);

export const agentContract = {
  /** Most recently active first. */
  sessions: oc.meta(forDevices(true)).output(type<AgentSession[]>()),
  /** Starts on what the user picked before its first message. */
  createSession: oc
    .meta(forDevices(true))
    .input(agentSessionSetupSchema)
    .output(type<AgentSession>()),
  /** Stops its run first, if one is going. */
  deleteSession: oc.meta(forDevices(true)).input(idSchema).output(type<void>()),
  /** The conversation as wire events to fold, including a run still going. */
  transcript: oc
    .meta(forDevices(true))
    .input(idSchema)
    .output(type<AgentWireEvent[]>()),
  /**
   * Starts a run and resolves once it is under way; its progress arrives through `events`.
   * `locale` is the app's language, which the agent replies in, and `timeZone` the user's own
   * clock, which the agent is told the time on.
   */
  send: oc
    .meta(forDevices(true))
    .input(
      z.object({
        id: idSchema,
        text: textSchema,
        screen: agentScreenSchema.nullable(),
        locale: localeSchema,
        timeZone: timeZoneSchema,
      })
    )
    .output(type<void>()),
  abort: oc.meta(forDevices(true)).input(idSchema).output(type<void>()),
  /**
   * Runs a run the app's exits parked again from where it stopped. Only a window may, since a
   * run a window started may run calls unasked.
   */
  retry: oc.input(idSchema).output(type<void>()),
  /**
   * Summarizes the conversation's older messages, guided by `instructions`, and resolves once the
   * summary is placed or nothing is old enough. Stopping the conversation stops it.
   */
  compact: oc
    .meta(forDevices(true))
    .input(z.object({ id: idSchema, instructions: textSchema.nullable() }))
    .output(type<CompactionOutcome>()),
  /** Answers a call waiting for the user to allow it. */
  approve: oc
    .input(
      z.object({ id: idSchema, toolCallId: idSchema, approved: z.boolean() })
    )
    .output(type<void>()),
  /** Sets whether the conversation's tool calls ask first, from its next call on. */
  setApprovalMode: oc
    .input(z.object({ id: idSchema, mode: approvalModeSchema }))
    .output(type<void>()),
  /** Sets the model the conversation runs on from its next run; `null` parts follow the default. */
  setModel: oc
    .meta(forDevices(true))
    .input(z.object({ id: idSchema, pick: agentModelPickSchema }))
    .output(type<void>()),
  /**
   * Whether the conversations' store failed, after which none of them is read or written until
   * the app starts again.
   */
  storeFailed: oc.meta(forDevices(true)).output(type<boolean>()),
  /** Quits the app and starts it again, which a failed store needs. */
  restart: oc.output(type<void>()),
  /** Yields every event of every conversation's runs, whichever window or task started them. */
  events: oc
    .meta(forDevices(true))
    .output(asyncIteratorObject(type<AgentUpdate>())),
  /** The conversations' store failed, which `storeFailed` tells from then on. */
  storeFailures: changesContract,
};
