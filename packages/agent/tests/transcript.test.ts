import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, test } from "vite-plus/test";

import { transcriptEvents, userMessage, userText } from "../src/transcript.ts";
import type { TranscriptEntry } from "../src/transcript.ts";
import { RunEndReason, ToolCallStatus, foldEvents } from "../src/wire.ts";

const user = (id: string, text: string): TranscriptEntry => ({
  id,
  message: userMessage(text, "time: now", 1),
});

const reply = (id: string, text: string): TranscriptEntry => ({
  id,
  message: fauxAssistantMessage(text, { timestamp: 2 }),
});

const toolCall = (id: string): TranscriptEntry => ({
  id,
  message: fauxAssistantMessage(
    fauxToolCall("get_account", {}, { id: "call-1" }),
    { stopReason: "toolUse", timestamp: 2 }
  ),
});

test("the thread shows what the user typed, not the app's context", () => {
  const message = userMessage("How is 2330?", "viewing: TW 2330", 1);

  expect(userText(message)).toBe("How is 2330?");
});

test("a finished conversation replays idle", () => {
  const view = foldEvents(
    transcriptEvents([user("u1", "hi"), reply("a1", "hello")], false)
  );

  expect(view.running).toBe(false);
  expect(view.items).toMatchObject([
    { kind: "user", messageId: "u1", text: "hi" },
    { kind: "assistant", messageId: "a1", text: "hello" },
  ]);
});

test("a run the app never finished replays as interrupted", () => {
  const view = foldEvents(
    transcriptEvents([user("u1", "hi"), toolCall("a1")], false)
  );

  expect(view.running).toBe(false);
  expect(view.items).toMatchObject([
    { kind: "user" },
    { kind: "assistant" },
    { kind: "tool", toolCallId: "call-1", status: ToolCallStatus.Aborted },
    { kind: "notice", reason: RunEndReason.Interrupted },
  ]);
});

test("a run still going replays running, with its calls open", () => {
  const view = foldEvents(
    transcriptEvents([user("u1", "hi"), toolCall("a1")], true)
  );

  expect(view.running).toBe(true);
  expect(view.items.at(-1)).toMatchObject({
    kind: "tool",
    status: ToolCallStatus.Running,
  });
});

test("an interrupted run is closed before the next one starts", () => {
  const view = foldEvents(
    transcriptEvents(
      [user("u1", "hi"), user("u2", "again"), reply("a1", "hello")],
      false
    )
  );

  expect(view.items).toMatchObject([
    { kind: "user", text: "hi" },
    { kind: "notice", reason: RunEndReason.Interrupted },
    { kind: "user", text: "again" },
    { kind: "assistant", text: "hello" },
  ]);
});
