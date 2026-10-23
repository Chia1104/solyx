import { mkdtemp, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vite-plus/test";
import { WebSocket } from "ws";

import { DEVICE_PROTOCOL, UNPAIRED_CLOSE_CODE } from "@solyx/api/devices";
import type { PairedDevice } from "@solyx/api/devices";

import { startEdge } from "../src/modules/devices/edge.ts";
import type { Edge } from "../src/modules/devices/edge.ts";

const DEVICE: PairedDevice = {
  id: "d1",
  name: "Phone",
  pairedAt: 1,
  signs: false,
};

const TOKEN = "token-of-d1";

/** A port nothing listens on now. */
function freePort() {
  return new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      // SAFETY: a server listening on a TCP port has an AddressInfo address.
      const { port } = server.address() as AddressInfo;

      server.close(() => resolve(port));
    });
  });
}

/** Answers a request to the edge with its status and body, sending `host` and `origin` as given. */
function send(
  port: number,
  path: string,
  headers: Record<string, string>,
  body?: string
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", ...headers },
      },
      (response) => {
        let text = "";

        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: text })
        );
      }
    );

    sent.on("error", reject);
    sent.end(body);
  });
}

let edge: Edge | undefined;

afterEach(async () => {
  await edge?.close();
  edge = undefined;
});

async function start() {
  const webRoot = await mkdtemp(join(tmpdir(), "solyx-web-"));

  await writeFile(join(webRoot, "index.html"), "<title>Solyx</title>");

  const port = await freePort();
  const served: PairedDevice[] = [];

  edge = await startEdge({
    port,
    webRoot,
    verify: (token) => (token === TOKEN ? DEVICE : null),
    pair: async ({ code }) =>
      code === "RIGHT" ? { token: TOKEN, device: DEVICE } : null,
    serve: (_socket, device) => served.push(device),
  });

  const origin = `http://localhost:${port}`;

  return { port, origin, served, host: `localhost:${port}` };
}

test("serves the renderer only to requests that name this computer", async () => {
  const { port, host } = await start();

  expect(await send(port, "/", { host })).toMatchObject({
    status: 200,
    body: "<title>Solyx</title>",
  });
  expect(await send(port, "/", { host: `127.0.0.1:${port}` })).toMatchObject({
    status: 200,
  });
  // A page that rebinds its own name to this computer reaches nothing.
  expect(await send(port, "/", { host: "solyx.example.com" })).toMatchObject({
    status: 421,
  });
});

test("pairs only from its own page and only with the code shown", async () => {
  const { port, host, origin } = await start();

  const pairing = (code: string, from: string) =>
    send(
      port,
      "/pair",
      { host, origin: from },
      JSON.stringify({ code, name: "Phone" })
    );

  expect(await pairing("RIGHT", "https://solyx.example.com")).toMatchObject({
    status: 403,
  });
  expect(await pairing("WRONG", origin)).toMatchObject({ status: 403 });

  const paired = await pairing("RIGHT", origin);

  expect(paired.status).toBe(200);
  expect(JSON.parse(paired.body)).toEqual({ token: TOKEN, device: DEVICE });
});

/** Opens `/rpc` as a browser would, and resolves with how the socket opened or closed. */
function connect(port: number, origin: string, token: string) {
  return new Promise<{ opened: boolean; code?: number; status?: number }>(
    (resolve) => {
      const socket = new WebSocket(
        `ws://localhost:${port}/rpc`,
        [DEVICE_PROTOCOL, token],
        {
          headers: { origin },
        }
      );

      socket.on("unexpected-response", (_request, response) =>
        resolve({ opened: false, status: response.statusCode })
      );
      socket.on("close", (code) => resolve({ opened: false, code }));
      socket.on("open", () => {
        // An unpaired browser is closed as soon as it opens.
        setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
            resolve({ opened: true });
          }
        }, 100);
      });
    }
  );
}

test("serves the router to a paired browser and closes an unpaired one with its own code", async () => {
  const { port, origin, served } = await start();

  expect(await connect(port, origin, TOKEN)).toEqual({ opened: true });
  expect(served).toEqual([DEVICE]);

  expect(await connect(port, origin, "someone-else")).toEqual({
    opened: false,
    code: UNPAIRED_CLOSE_CODE,
  });
  expect(served).toHaveLength(1);
});

test("refuses a socket another site's page opens, even with a paired token", async () => {
  const { port, served } = await start();

  expect(await connect(port, "https://solyx.example.com", TOKEN)).toEqual({
    opened: false,
    status: 403,
  });
  expect(served).toEqual([]);
});
