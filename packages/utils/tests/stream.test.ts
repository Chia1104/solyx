import { expect, test } from "vite-plus/test";

import { lines } from "../src/stream.ts";

test("lines come whole however the bytes are cut, through a character's bytes too", async () => {
  const bytes = new TextEncoder().encode('{"a":1}\n{"b":"台積電"}\nlast');
  // 台 takes bytes 14 to 16, so the cut at 15 falls inside it.
  const cuts = [0, 5, 15, 20, bytes.length];

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [index, at] of cuts.slice(0, -1).entries()) {
        controller.enqueue(bytes.slice(at, cuts[index + 1]));
      }

      controller.close();
    },
  });

  const read: string[] = [];

  for await (const line of lines(body)) read.push(line);

  expect(read).toEqual(['{"a":1}', '{"b":"台積電"}', "last"]);
});
