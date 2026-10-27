import type { PdfReply, PdfRequest } from "../../worker/pdf-protocol.ts";

import { runOnce } from "./one-shot-thread.ts";

/** How long a PDF may take to read before its thread is ended. */
const PDF_TIMEOUT_MS = 60_000;

/** The heap a PDF's reading may take, since pdf.js holds what a page draws while it reads it. */
const PDF_HEAP_MB = 1024;

/** Reads the text of a PDF a message carries, page by page. */
export interface PdfReader {
  pages(bytes: Uint8Array, name: string): Promise<string[]>;
}

/**
 * Reads each PDF in a worker thread of its own, which ends with it, under a deadline and a cap on
 * its memory, since a file can be made to take any amount of either.
 */
export function createPdfThreads(files: {
  /** The thread's entry, built as its own bundle. */
  worker: URL;
  /** pdf.js's CMaps, ending in a separator. */
  cmaps: string;
}): PdfReader {
  return {
    async pages(bytes, name) {
      const request: PdfRequest = { cmaps: files.cmaps, bytes };

      const reply = await runOnce<PdfRequest, PdfReply>(files.worker, request, {
        job: `reading of ${name}`,
        timeoutMs: PDF_TIMEOUT_MS,
        resourceLimits: { maxOldGenerationSizeMb: PDF_HEAP_MB },
      });

      if ("pages" in reply) return reply.pages;

      throw new Error(
        reply.locked
          ? `${name} is locked with a password, so its text cannot be read`
          : `${name} could not be read as a PDF: ${reply.error}`
      );
    },
  };
}
