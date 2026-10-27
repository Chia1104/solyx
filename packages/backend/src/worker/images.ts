// The thread an image a message carries is prepared in, built as its own bundle since a worker
// starts from a file. It prepares the one image it was started with, posts it and ends.
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

import { createPhotonImages } from "@earendil-works/pi-durable/images";

import type { ImageReply, ImageRequest } from "./images-protocol.ts";

// SAFETY: only the backend starts this thread, and it hands it nothing but an ImageRequest.
const request = workerData as ImageRequest;

let reply: ImageReply;

try {
  const images = createPhotonImages(await readFile(request.wasm));

  reply = {
    result: await images.prepare(
      request.bytes,
      request.mimeType,
      request.limits
    ),
  };
} catch (error) {
  reply = { error: error instanceof Error ? error.message : String(error) };
}

parentPort?.postMessage(reply);
