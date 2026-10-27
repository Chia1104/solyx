import { constants } from "node:fs";
import { mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";

import { MAX_ATTACHMENT_BYTES, readAttachment } from "@solyx/agent/attachment";
import type { AgentAttachment } from "@solyx/agent/runtime";

/** The folder of a conversation's folder that keeps the files its messages carried. */
const ATTACHMENTS = "attachments";

/**
 * Where `path` really is under `workspace`, which the conversation's commands may write in: a link
 * they made that would take it out of the folder is refused rather than followed.
 */
async function insideWorkspace(workspace: string, path: string) {
  const [root, real] = await Promise.all([
    realpath(workspace),
    realpath(join(workspace, path)),
  ]);

  if (!real.startsWith(root + sep)) {
    throw new Error(`${path} is not in its conversation's folder`);
  }

  return real;
}

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
    await mkdir(join(workspace, ATTACHMENTS), { recursive: true });

    // A new folder and a new file each, so nothing already there, a link among it, is written
    // through; the folder is checked again once made, against a link swapped in meanwhile.
    await mkdir(
      join(await insideWorkspace(workspace, ATTACHMENTS), String(at))
    );

    const real = await insideWorkspace(workspace, folder);

    await Promise.all(
      kept.map(({ bytes, attachment }) =>
        writeFile(join(real, attachment.name), bytes, { flag: "wx" })
      )
    );
  }

  return {
    attachments: kept.map(({ attachment }) => attachment),
    remove: () => rm(join(workspace, folder), { recursive: true, force: true }),
  };
}

/** A file a message carried, as `keepAttachments` kept it at `path` in the conversation's folder. */
export async function keptAttachment(workspace: string, path: string) {
  // Opened without following a link, and only as a file no larger than any attached, so what a
  // command left at the place is never read in its stead.
  const handle = await open(
    await insideWorkspace(workspace, path),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );

  try {
    const stats = await handle.stat();

    if (!stats.isFile() || stats.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${path} is not a file a message carried`);
    }

    const bytes = new Uint8Array(await handle.readFile());
    const name = basename(path);

    return new File([bytes], name, {
      type: readAttachment(name, bytes).mimeType,
    });
  } finally {
    await handle.close();
  }
}
