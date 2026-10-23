import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as z from "zod";

/**
 * This installation's id, created on first use and the same ever after; Sign in with ChatGPT
 * names the agent host by it. Synchronous because pi-ai asks for it synchronously.
 */
export function installationId(file: string): () => string {
  let id: string | undefined;

  return () => {
    if (id) return id;

    try {
      id = z.uuid().parse(readFileSync(file, "utf8").trim());
    } catch {
      // Missing or damaged: a new id only means OpenAI sees a new agent host.
      id = crypto.randomUUID();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, id);
    }

    return id;
  };
}
