import type { ImageProcessor } from "@earendil-works/pi-durable/tools";

import type { ImageReply, ImageRequest } from "../../worker/images-protocol.ts";

import { runOnce } from "./one-shot-thread.ts";

/** How long an image may take to scale before its thread is ended; a photo takes a second or two. */
const IMAGE_TIMEOUT_MS = 60_000;

/**
 * Prepares each image a message carries in a worker thread of its own, which ends with it: Photon
 * takes a second or so to decode a photo, and the memory it decodes into never shrinks while its
 * thread lives.
 */
export function createImageThreads(files: {
  /** The thread's entry, built as its own bundle. */
  worker: URL;
  /** Photon's WebAssembly. */
  wasm: string;
}): ImageProcessor {
  return {
    async prepare(bytes, mimeType, limits) {
      const request: ImageRequest = {
        wasm: files.wasm,
        bytes,
        mimeType,
        limits,
      };

      const reply = await runOnce<ImageRequest, ImageReply>(
        files.worker,
        request,
        {
          job: "image's scaling",
          timeoutMs: IMAGE_TIMEOUT_MS,
        }
      );

      if ("error" in reply) throw new Error(reply.error);

      return reply.result;
    },
  };
}
