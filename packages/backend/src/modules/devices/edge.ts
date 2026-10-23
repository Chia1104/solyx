import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import {
  DEVICE_PROTOCOL,
  UNPAIRED_CLOSE_CODE,
  pairingRequestSchema,
} from "@solyx/api/devices";
import type { Pairing, PairedDevice, PairingRequest } from "@solyx/api/devices";

/** The only names a request may give this computer by, so a page that rebinds a name of its own to it reaches nothing. */
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The name a `Host` header gives, without its port, which `ssh -L` and the like pick freely. */
function hostName(host: string) {
  const name = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];

  return name.toLowerCase();
}

/** A browser's request from a page the edge served, rather than from another site's. */
const fromItsOwnPage = (c: Context) =>
  c.req.header("origin") === `http://${c.req.header("host")}`;

/** Serves the router on a paired device's socket, opened from a page at `origin`. */
export type ServeDevice = (
  socket: WebSocket,
  device: PairedDevice,
  origin: string
) => void;

export interface EdgeOptions {
  port: number;
  /** The folder holding the renderer's build, which the edge serves. */
  webRoot: string;
  /** The device a token belongs to; `null` for one no paired device holds. */
  verify: (token: string) => PairedDevice | null;
  /** Pairs a device with the code the desktop shows; `null` for a code that is not that one. */
  pair: (request: PairingRequest) => Promise<Pairing | null>;
  serve: ServeDevice;
}

/**
 * Serves the renderer's build and, on `/rpc`, the router to paired browsers, on this computer's
 * own address alone. Answers once it listens, or fails with why it could not.
 */
export function startEdge(options: EdgeOptions) {
  const sockets = new Map<string, Set<WebSocket>>();

  const app = new Hono();

  app.use(async (c, next) => {
    const host = c.req.header("host");

    if (!host || !LOCAL_NAMES.has(hostName(host))) {
      return c.text("Solyx answers only this computer's own address", 421);
    }

    await next();
  });

  app.use(secureHeaders());

  app.post("/pair", async (c) => {
    if (!fromItsOwnPage(c)) return c.text("Pair from Solyx's own page", 403);

    const request = pairingRequestSchema.safeParse(
      await c.req.json().catch(() => null)
    );

    if (!request.success)
      return c.text("Name the device and give its code", 400);

    const pairing = await options.pair(request.data);

    return pairing
      ? c.json(pairing)
      : c.text("That code is not the one Solyx shows, or it has expired", 403);
  });

  app.get(
    "/rpc",
    async (c, next) => {
      if (!fromItsOwnPage(c))
        return c.text("Connect from Solyx's own page", 403);

      await next();
    },
    upgradeWebSocket((c) => {
      const [protocol, token] = (c.req.header("sec-websocket-protocol") ?? "")
        .split(",")
        .map((part) => part.trim());

      const device =
        protocol === DEVICE_PROTOCOL && token ? options.verify(token) : null;

      // The route took only a page the edge served, so its origin names this computer.
      const origin = `http://${c.req.header("host")}`;

      return {
        onOpen(_event, ws) {
          // SAFETY: the server upgrades through `websockets`, a `ws` server, so every socket is `ws`'s.
          const socket = ws.raw as WebSocket | undefined;

          if (!device || !socket) {
            ws.close(UNPAIRED_CLOSE_CODE, "This browser is not paired");

            return;
          }

          const held = sockets.get(device.id) ?? new Set();

          held.add(socket);
          sockets.set(device.id, held);
          options.serve(socket, device, origin);
        },
        onClose(_event, ws) {
          // SAFETY: as in `onOpen`.
          const socket = ws.raw as WebSocket | undefined;

          if (device && socket) sockets.get(device.id)?.delete(socket);
        },
      };
    })
  );

  app.use("/*", serveStatic({ root: options.webRoot }));

  // A browser offers the protocol with its token beside it, and must hear one of them back.
  const websockets = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) =>
      protocols.has(DEVICE_PROTOCOL) ? DEVICE_PROTOCOL : false,
  });

  return new Promise<{
    url: string;
    /** Closes every connection `device` holds, as it is unpaired. */
    disconnect: (device: string) => void;
    close: () => Promise<void>;
  }>((resolve, reject) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
      hostname: "127.0.0.1",
      websocket: { server: websockets },
    });

    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve({
        url: `http://localhost:${options.port}/`,

        disconnect(device) {
          for (const socket of sockets.get(device) ?? []) {
            socket.close(UNPAIRED_CLOSE_CODE, "This browser was unpaired");
          }

          sockets.delete(device);
        },

        close: () =>
          new Promise<void>((done) => {
            for (const held of sockets.values()) {
              for (const socket of held) socket.close();
            }

            sockets.clear();
            websockets.close();
            server.close(() => done());
          }),
      });
    });
  });
}

export type Edge = Awaited<ReturnType<typeof startEdge>>;
