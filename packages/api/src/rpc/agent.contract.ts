import { asyncIteratorObject, oc, type } from "@orpc/contract";
import * as z from "zod";

import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "@solyx/agent/attachment";
import { agentModelPickSchema } from "@solyx/agent/providers";
import { agentSessionSetupSchema, approvalModeSchema } from "@solyx/agent/wire";
import type {
  AgentSession,
  AgentWireEvent,
  CompactionOutcome,
} from "@solyx/agent/wire";

import { agentScreenSchema } from "../agent.ts";
import type { AgentUpdate, FileText } from "../agent.ts";
import { localeSchema, timeZoneSchema } from "../settings.ts";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

const idSchema = z.string().min(1);

const textSchema = z.string().trim().min(1).max(20_000);

/** A file a message of a conversation carried, by where it stands among the message's files. */
const carriedFileSchema = z.object({
  id: idSchema,
  messageId: idSchema,
  index: z
    .number()
    .int()
    .min(0)
    .max(MAX_ATTACHMENTS - 1),
});

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
   * clock, which the agent is told the time on. Each file in `attachments` is read again as it
   * arrives, as `readAttachment` reads it, so a file the renderer let through may still be refused.
   */
  send: oc
    .meta(forDevices(true))
    .input(
      z.object({
        id: idSchema,
        text: textSchema,
        attachments: z
          .array(z.file().max(MAX_ATTACHMENT_BYTES))
          .max(MAX_ATTACHMENTS),
        screen: agentScreenSchema.nullable(),
        locale: localeSchema,
        timeZone: timeZoneSchema,
      })
    )
    .output(type<void>()),
  /**
   * The image a message of the conversation carried as its `index`th file, as scaled for the
   * model, which is the one copy the app keeps of it, for the thread to show.
   */
  attachmentImage: oc
    .meta(forDevices(true))
    .input(carriedFileSchema)
    .output(type<File>()),
  /**
   * The text a message of the conversation carried as its `index`th file, a text file's own or
   * what was read of a PDF, for the thread to preview; `null` once the conversation's folder no
   * longer keeps it, as when a command removed it.
   */
  attachmentText: oc
    .meta(forDevices(true))
    .input(carriedFileSchema)
    .output(type<FileText | null>()),
  /** The text `send` would read of a file, a PDF's among them, for the composer to preview. */
  fileText: oc
    .meta(forDevices(true))
    .input(z.file().max(MAX_ATTACHMENT_BYTES))
    .output(type<FileText>()),
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
