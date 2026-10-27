import { Worker } from "node:worker_threads";

import type { ImageProcessor } from "@earendil-works/pi-durable/tools";

import type { ImageReply, ImageRequest } from "../../worker/images-protocol.ts";

/** How long an image may take to scale before its thread is ended; a photo takes a second or two. */
const IMAGE_TIMEOUT_MS = 60_000;

/**
 * Prepares each image a message carries in a worker thread of its own, which ends with it: Photon
 * takes a second or so to decode a photo, which would hold the event loop every window, the
 * scheduler and the order desk share, and the memory it decodes into never shrinks while its
 * thread lives.
 */
export function createImageThreads(files: {
  /** The thread's entry, built as its own bundle. */
  worker: URL;
  /** Photon's WebAssembly. */
  wasm: string;
}): ImageProcessor {
  return {
    prepare: (bytes, mimeType, limits) =>
      new Promise((resolve, reject) => {
        const request: ImageRequest = {
          wasm: files.wasm,
          bytes,
          mimeType,
          limits,
        };

        const thread = new Worker(files.worker, { workerData: request });

        const deadline = setTimeout(() => {
          reject(new Error("The image took too long to scale"));
          void thread.terminate();
        }, IMAGE_TIMEOUT_MS);

        thread.once("message", (reply: ImageReply) => {
          if ("error" in reply) reject(new Error(reply.error));
          else resolve(reply.result);
        });
        thread.once("error", reject);
        // Too late to matter once the thread has answered, since a promise settles once.
        thread.once("exit", (code) => {
          clearTimeout(deadline);
          reject(
            new Error(
              `The image thread ended with code ${code} before it answered`
            )
          );
        });
      }),
  };
}
