import { randomInt } from "node:crypto";

import { Mutex, isEqual } from "es-toolkit";
import type { WebSocket } from "ws";

import type {
  PairedDevice,
  PairingCode,
  RemoteAccess,
} from "@solyx/api/devices";
import { errorMessage } from "@solyx/utils/error";

import type { ConfigFile } from "../settings/config-file.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

import type { DeviceRegistry } from "./device-registry.ts";
import { startEdge } from "./edge.ts";
import type { Edge } from "./edge.ts";

// Long enough to type on another device, short enough that a code seen over a shoulder soon goes.
const CODE_TTL_MS = 5 * 60_000;

// A wrong guess or a typo; past this the code is gone, so it cannot be guessed at.
const CODE_ATTEMPTS = 5;

// No 0, O, 1 or I, which read alike.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const CODE_LENGTH = 8;

export interface DevicesOptions {
  config: ConfigFile;
  registry: DeviceRegistry;
  /** The folder holding the renderer's build, which the edge serves. */
  webRoot: string;
  diagnostics: Diagnostics;
  onChange: () => void;
}

/**
 * The browsers paired with this computer and the edge they reach the backend through, which
 * listens only while `remote.enabled` is on and follows the setting, whoever changed it.
 */
export function createDevices({
  config,
  registry,
  webRoot,
  diagnostics,
  onChange,
}: DevicesOptions) {
  const mutex = new Mutex();

  let serve: ((socket: WebSocket, device: PairedDevice) => void) | undefined;

  let edge: Edge | undefined;
  let listening: { enabled: boolean; port: number } | undefined;
  let error: string | null = null;
  let code: (PairingCode & { attempts: number }) | undefined;

  const setting = () => config.read().remote;

  /** Starts, stops or moves the edge to match the setting. */
  async function follow() {
    await mutex.acquire();

    try {
      const wanted = setting();

      if (!serve || isEqual(wanted, listening)) return;

      await edge?.close();
      edge = undefined;
      error = null;
      listening = wanted;

      if (wanted.enabled) {
        try {
          edge = await startEdge({
            port: wanted.port,
            webRoot,
            verify: (token) => registry.verify(token),
            pair,
            serve,
          });
        } catch (cause) {
          error = errorMessage(cause);
          diagnostics.recovered(cause, "devices.edge");
        }
      }

      onChange();
    } finally {
      mutex.release();
    }
  }

  async function pair({ code: given, name }: { code: string; name: string }) {
    if (!code || Date.now() > code.expiresAt) return null;

    if (given.toUpperCase() !== code.code) {
      code.attempts += 1;

      if (code.attempts >= CODE_ATTEMPTS) code = undefined;

      onChange();

      return null;
    }

    code = undefined;

    const pairing = await registry.pair(name);

    onChange();

    return pairing;
  }

  config.onChange(() => void follow());

  return {
    remoteAccess(): RemoteAccess {
      const { enabled, port } = setting();

      return { enabled, port, url: edge?.url ?? null, error };
    },

    setEnabled(enabled: boolean) {
      config.set(["remote", "enabled"], enabled);
    },

    /** A new code for one browser to pair with, in place of any shown before. */
    pairingCode(): PairingCode {
      code = {
        code: Array.from(
          { length: CODE_LENGTH },
          () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
        ).join(""),
        expiresAt: Date.now() + CODE_TTL_MS,
        attempts: 0,
      };

      onChange();

      return { code: code.code, expiresAt: code.expiresAt };
    },

    list: () => registry.list(),

    async remove(id: string) {
      await registry.remove(id);
      edge?.disconnect(id);
      onChange();
    },

    /** Has the edge serve the router to paired devices through `socket`, and start as the setting says. */
    async listen(
      serveDevice: (socket: WebSocket, device: PairedDevice) => void
    ) {
      serve = serveDevice;
      await follow();
    },

    async close() {
      await mutex.acquire();

      try {
        serve = undefined;
        await edge?.close();
        edge = undefined;
      } finally {
        mutex.release();
      }
    },
  };
}

export type Devices = ReturnType<typeof createDevices>;
