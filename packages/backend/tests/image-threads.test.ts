import { createRequire } from "node:module";
import { crc32, deflateSync } from "node:zlib";

import { expect, test } from "vite-plus/test";

import { createImageThreads } from "../src/modules/agent/image-threads.ts";

// pi-durable's own copy of Photon, which the app ships beside its bundle.
const wasm = createRequire(
  import.meta.resolve("@earendil-works/pi-durable/images")
).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm");

// The thread's own entry, which the app builds into a file beside the main bundle.
const images = createImageThreads({
  worker: new URL("../src/worker/images.ts", import.meta.url),
  wasm,
});

/** A grey PNG of `size` by `size` pixels, made by hand so the test needs no encoder. */
function png(size: number) {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    const check = Buffer.alloc(4);

    length.writeUInt32BE(data.length);
    check.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, check]);
  };

  const header = Buffer.alloc(13);

  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  // Eight bits a sample, greyscale, no interlacing.
  header.set([8, 0, 0, 0, 0], 8);

  // Each row opens with its filter, none, then a byte a pixel.
  const rows = Buffer.alloc(size * (size + 1), 0x80);

  for (let row = 0; row < size; row++) rows[row * (size + 1)] = 0;

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", new Uint8Array()),
    ])
  );
}

const LIMITS = { maxWidth: 2000, maxHeight: 2000, maxBytes: 4_718_592 };

test("an image within the model's limits goes as it is, and a larger one is scaled to fit", async () => {
  const small = png(4);

  expect(await images.prepare(small, "image/png", LIMITS)).toEqual({
    data: Buffer.from(small).toString("base64"),
    mimeType: "image/png",
  });

  expect(
    await images.prepare(png(8), "image/png", {
      ...LIMITS,
      maxWidth: 4,
      maxHeight: 4,
    })
  ).toMatchObject({
    resized: { from: { width: 8, height: 8 }, to: { width: 4, height: 4 } },
  });
});

test("bytes that only start like an image are not one", async () => {
  await expect(
    images.prepare(png(4).subarray(0, 20), "image/png", LIMITS)
  ).resolves.toBeUndefined();
});
