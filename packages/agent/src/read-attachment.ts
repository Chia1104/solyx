import { defineExtension } from "@earendil-works/pi-durable";
import type { ConversationId, Extension } from "@earendil-works/pi-durable";
import * as z from "zod";

import { ATTACHMENT_PATH } from "./attachment.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

/** The text of the files the conversation's messages carried, as the host keeps them. */
export interface AttachmentReader {
  /** A file's whole text, a PDF's as `pdfText` sets it under its pages; an image has none. */
  text(conversationId: ConversationId, path: string): Promise<string>;
}

/** How much text a read hands back, a few thousand tokens. */
const READ_CHARACTERS = 20_000;

/** How many places a search lists. */
const FOUND = 20;

// Around each place a search found, so the model can tell which to read.
const BEFORE = 80;

const AFTER = 160;

// A search's start leaves room before the words, so a read from it opens on their context.
const LEAD = 400;

const PAGE = /\[page (\d+)\]\n/g;

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The page the character at `at` sits on, where the text is a PDF's. */
function pageAt(text: string, at: number) {
  let page: number | undefined;

  for (const marker of text.matchAll(PAGE)) {
    if (marker.index > at) break;

    page = Number(marker[1]);
  }

  return page;
}

function readText(path: string, text: string, start: number) {
  const end = Math.min(text.length, start + READ_CHARACTERS);
  const first = pageAt(text, start);
  const last = pageAt(text, Math.max(start, end - 1));
  const pages = pageAt(text, text.length);

  return [
    `${nameOf(path)}: characters ${start + 1} to ${end} of ${text.length}`,
    first === undefined ? "" : `, pages ${first} to ${last} of ${pages}`,
    end < text.length
      ? `. Read on with start ${end}.`
      : ". That is the end of it.",
    "\n\n",
    text.slice(start, end),
  ].join("");
}

function searchText(path: string, text: string, words: string) {
  const haystack = text.toLocaleLowerCase();
  const needle = words.toLocaleLowerCase();
  const found: number[] = [];

  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    found.push(at);
  }

  if (found.length === 0) return `"${words}" is nowhere in ${nameOf(path)}.`;

  return [
    `"${words}" appears ${found.length} times in ${nameOf(path)}${found.length > FOUND ? `; the first ${FOUND}` : ""}:`,
    ...found.slice(0, FOUND).map((at) => {
      const page = pageAt(text, at);

      const around = text
        .slice(Math.max(0, at - BEFORE), at + needle.length + AFTER)
        .replace(/\s+/g, " ")
        .trim();

      return `- start ${Math.max(0, at - LEAD)}${page === undefined ? "" : ` (page ${page})`}: …${around}…`;
    }),
  ].join("\n");
}

/**
 * `read_attachment`: the text of a file a message of this conversation carried, through the
 * host's `AttachmentReader`, a part at a time or where some words appear, for files too long to
 * ride inside their message. It reads only what the user attached here and changes nothing, so it
 * never asks.
 */
export function createAttachmentTools({
  reader,
}: {
  reader: AttachmentReader;
}): Extension {
  return defineExtension({
    name: "solyx-attachments",
    tools: [
      defineTool({
        name: AgentToolName.ReadAttachment,
        replay: "safe",
        description: `Reads the text of a file the user attached to a message in this conversation, by the path its <attachment> tag names: a text file or a PDF too long to ride inside its message, whose tag gives its length in characters. It hands back ${READ_CHARACTERS} characters from start, or, given search, each place those words appear with the start to read it from. A PDF's text sits under a [page n] line for each page.`,
        parameters: z.object({
          path: z
            .string()
            .regex(ATTACHMENT_PATH)
            .describe("The path the file's <attachment> tag gives"),
          start: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              "The character to read from: 0, or what the last read or a search gave"
            ),
          search: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .optional()
            .describe("Words to find in place of reading"),
        }),
        async execute({ path, start = 0, search }, api) {
          const text = await reader.text(api.conversationId, path);

          if (search !== undefined) {
            return { text: searchText(path, text, search), details: { path } };
          }

          if (start >= text.length) {
            throw new Error(
              `${nameOf(path)} holds ${text.length} characters, so it has none from ${start}`
            );
          }

          return { text: readText(path, text, start), details: { path } };
        },
      }),
    ],
  });
}
