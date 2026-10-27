import { constants } from "node:fs";
import { mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";

import {
  ATTACHMENT_PATH,
  AttachmentKind,
  MAX_ATTACHMENT_BYTES,
  PDF_TYPE,
  pdfText,
  readAttachment,
} from "@solyx/agent/attachment";
import type { ReadAttachment } from "@solyx/agent/attachment";
import type { AgentAttachment } from "@solyx/agent/runtime";

import type { PdfReader } from "./pdf-threads.ts";

/** The folder of a conversation's folder that keeps the text its messages' files carried. */
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

/** A file as its message carries it, before it has a place in the conversation's folder. */
type Carried = Exclude<ReadAttachment, { kind: typeof AttachmentKind.Pdf }> & {
  pages?: number;
};

/** A file as its message carries it: a PDF as the text read of it, page by page. */
async function carried(
  attachment: ReadAttachment,
  pdf: PdfReader
): Promise<Carried> {
  if (attachment.kind !== AttachmentKind.Pdf) return attachment;

  const pages = await pdf.pages(attachment.data, attachment.name);

  if (pages.every((page) => page.trim() === "")) {
    throw new Error(
      `${attachment.name} holds no text to read, as a scanned PDF has none; attach its pages as images instead`
    );
  }

  return {
    kind: AttachmentKind.Text,
    name: attachment.name,
    size: attachment.size,
    mimeType: PDF_TYPE,
    text: pdfText(pages),
    pages: pages.length,
  };
}

/**
 * Reads the files a message carries, throwing as `readAttachment` does for one that cannot ride
 * with it and for a PDF whose text cannot be read, and keeps of each only what the agent reads, so
 * nothing of it is kept twice: an image only as its message carries it, scaled for the model, and
 * a text file as attached and a PDF's text in a folder of the message's own under its
 * conversation's, where `read_attachment` and the shell's commands find them. That folder goes
 * into backups with the conversation and away with it. `remove` takes it away again for a message
 * that was not sent.
 */
export async function keepAttachments(
  workspace: string,
  files: readonly File[],
  at: number,
  pdf: PdfReader
): Promise<{ attachments: AgentAttachment[]; remove: () => Promise<void> }> {
  const read = await Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());

      return { bytes, attachment: readAttachment(file.name, bytes) };
    })
  );

  // One PDF at a time, each read before anything is kept, so one that cannot be read keeps none.
  const texts: Carried[] = [];

  for (const { attachment } of read) texts.push(await carried(attachment, pdf));

  const folder = join(ATTACHMENTS, String(at));
  const taken = new Set<string>();

  const kept = read.map(({ bytes, attachment: original }, index) => {
    const attachment = texts[index];

    if (attachment.kind === AttachmentKind.Image) {
      return { attachment, file: undefined };
    }

    // A PDF keeps the text read of it, which the shell then reads as text.
    const pdfText = original.kind === AttachmentKind.Pdf;

    const name = unique(
      pdfText ? `${attachment.name}.txt` : attachment.name,
      taken
    );

    taken.add(name);

    // The model reads the path from where its commands start, which is the same on every system.
    return {
      attachment: { ...attachment, path: `${ATTACHMENTS}/${at}/${name}` },
      file: { name, data: pdfText ? attachment.text : bytes },
    };
  });

  const written = kept.flatMap(({ file }) => (file ? [file] : []));

  if (written.length > 0) {
    await mkdir(join(workspace, ATTACHMENTS), { recursive: true });

    // A new folder and a new file each, so nothing already there, a link among it, is written
    // through; the folder is checked again once made, against a link swapped in meanwhile.
    await mkdir(
      join(await insideWorkspace(workspace, ATTACHMENTS), String(at))
    );

    const real = await insideWorkspace(workspace, folder);

    await Promise.all(
      written.map(({ name, data }) =>
        writeFile(join(real, name), data, { flag: "wx" })
      )
    );
  }

  return {
    attachments: kept.map(({ attachment }) => attachment),
    remove: () => rm(join(workspace, folder), { recursive: true, force: true }),
  };
}

/**
 * The bytes at `path` in the conversation's folder, opened without following a link and only as a
 * file no larger than any attached, so what a command left at the place is never read in its stead.
 */
async function readKept(workspace: string, path: string) {
  const handle = await open(
    await insideWorkspace(workspace, path),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );

  try {
    const stats = await handle.stat();

    if (!stats.isFile() || stats.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${path} is not a file a message carried`);
    }

    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

/** The text `read_attachment` reads of a file a message carried, a text file's own or a PDF's. */
export async function attachmentText(workspace: string, path: string) {
  if (!ATTACHMENT_PATH.test(path)) {
    throw new Error(`${path} is not where a message's file is kept`);
  }

  const name = basename(path);
  const attachment = readAttachment(name, await readKept(workspace, path));

  if (attachment.kind !== AttachmentKind.Text) {
    throw new Error(`${name} holds no text kept for the agent to read`);
  }

  return attachment.text;
}
