// The thread a PDF a message carries is read in, built as its own bundle since a worker starts
// from a file. It reads the text of the one file it was started with, posts it and ends.
import { parentPort, workerData } from "node:worker_threads";

import { extractText, getDocumentProxy } from "unpdf";

import type { PdfReply, PdfRequest } from "./pdf-protocol.ts";

// SAFETY: only the backend starts this thread, and it hands it nothing but a PdfRequest.
const request = workerData as PdfRequest;

let reply: PdfReply;

try {
  const document = await getDocumentProxy(request.bytes, {
    // Fonts that name a predefined CMap, as many CJK documents do, read through these files.
    cMapUrl: request.cmaps,
    cMapPacked: true,
    useSystemFonts: false,
    disableFontFace: true,
  });

  const { text } = await extractText(document, { mergePages: false });

  reply = { pages: text };
} catch (error) {
  reply = {
    error: error instanceof Error ? error.message : String(error),
    locked: error instanceof Error && error.name === "PasswordException",
  };
}

parentPort?.postMessage(reply);
