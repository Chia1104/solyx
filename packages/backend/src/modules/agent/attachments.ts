import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readAttachment } from "@solyx/agent/attachment";
import type { AgentAttachment } from "@solyx/agent/runtime";

/** The folder of a conversation's folder that keeps the files its messages carried. */
const ATTACHMENTS = "attachments";

/** `name`, or the first of `name (2)`, `name (3)`, … that `taken` does not hold. */
function unique(name: string, taken: ReadonlySet<string>) {
  const dot = name.lastIndexOf(".");

  const [stem, extension] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];

  let candidate = name;

  for (let count = 2; taken.has(candidate); count++) {
    candidate = `${stem} (${count})${extension}`;
  }

  return candidate;
}

/**
 * Reads the files a message carries, throwing as `readAttachment` does for one that cannot ride
 * with it, and keeps each as it was attached in a folder of the message's own under its
 * conversation's, where the shell's commands start, so they go with the conversation's folder:
 * into backups, and away with the conversation. `remove` takes them away again for a message
 * that was not sent.
 */
export async function keepAttachments(
  workspace: string,
  files: readonly File[],
  at: number
): Promise<{ attachments: AgentAttachment[]; remove: () => Promise<void> }> {
  const read = await Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());

      return { bytes, attachment: readAttachment(file.name, bytes) };
    })
  );

  const folder = join(ATTACHMENTS, String(at));
  const taken = new Set<string>();

  const kept = read.map(({ bytes, attachment }) => {
    const name = unique(attachment.name, taken);

    taken.add(name);

    // The model reads the path from where its commands start, which is the same on every system.
    return {
      bytes,
      attachment: { ...attachment, name, path: `${ATTACHMENTS}/${at}/${name}` },
    };
  });

  if (kept.length > 0) {
    await mkdir(join(workspace, folder), { recursive: true });

    await Promise.all(
      kept.map(({ bytes, attachment }) =>
        writeFile(join(workspace, folder, attachment.name), bytes)
      )
    );
  }

  return {
    attachments: kept.map(({ attachment }) => attachment),
    remove: () => rm(join(workspace, folder), { recursive: true, force: true }),
  };
}
