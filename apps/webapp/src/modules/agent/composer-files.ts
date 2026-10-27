import { useRef, useState } from "react";
import type { ClipboardEvent } from "react";

import type { DropItem } from "react-aria-components";

import {
  AttachmentKind,
  AttachmentRefusal,
  AttachmentRefused,
  MAX_ATTACHMENTS,
  readAttachment,
} from "@solyx/agent/attachment";
import type { ReadAttachment } from "@solyx/agent/attachment";

/** A file the next message carries, read as the backend will read it again. */
export interface PendingFile {
  id: string;
  file: File;
  attachment: ReadAttachment;
}

/** Why the composer would not take a file. */
const FileRefusal = {
  ...AttachmentRefusal,
  /** The message already carries as many files as one may. */
  TooMany: "too-many",
} as const;

type FileRefusal = (typeof FileRefusal)[keyof typeof FileRefusal];

export interface RefusedFile {
  name: string;
  reason: FileRefusal;
}

/** A file as the backend would read it, or why it would refuse it. */
async function read(
  file: File
): Promise<{ attachment: ReadAttachment } | { refusal: AttachmentRefusal }> {
  try {
    return {
      attachment: readAttachment(
        file.name,
        new Uint8Array(await file.arrayBuffer())
      ),
    };
  } catch (error) {
    if (error instanceof AttachmentRefused) return { refusal: error.reason };

    throw error;
  }
}

/**
 * The files the next message carries, each read by the rules the backend reads it by, so one it
 * would refuse is refused as it is added, with why, and never sent. Files come picked, dropped on
 * the composer or pasted; text dropped goes to `insertText`.
 */
export function useComposerFiles({
  blind,
  insertText,
}: {
  /** The conversation's model sees no images, so a message holding one cannot go. */
  blind: boolean;
  insertText: (text: string) => void;
}) {
  // The files as the last change left them, which a change still reading files builds on.
  const held = useRef<readonly PendingFile[]>([]);
  const [files, setFiles] = useState<readonly PendingFile[]>([]);
  const [refused, setRefused] = useState<readonly RefusedFile[]>([]);
  const [reading, setReading] = useState(0);

  function hold(next: readonly PendingFile[]) {
    held.current = next;
    setFiles(next);
  }

  async function add(incoming: readonly File[]) {
    if (incoming.length === 0) return;

    setReading((count) => count + 1);

    try {
      const verdicts = await Promise.all(
        incoming.map(async (file) => ({ file, verdict: await read(file) }))
      );

      const kept = [...held.current];
      const turnedAway: RefusedFile[] = [];

      for (const { file, verdict } of verdicts) {
        if ("refusal" in verdict) {
          turnedAway.push({ name: file.name, reason: verdict.refusal });
        } else if (kept.length >= MAX_ATTACHMENTS) {
          turnedAway.push({ name: file.name, reason: FileRefusal.TooMany });
        } else {
          kept.push({
            id: crypto.randomUUID(),
            file,
            attachment: verdict.attachment,
          });
        }
      }

      hold(kept);
      setRefused(turnedAway);
    } finally {
      setReading((count) => count - 1);
    }
  }

  async function drop({ items }: { items: readonly DropItem[] }) {
    const dropped = await Promise.all(
      items.flatMap((item) => (item.kind === "file" ? [item.getFile()] : []))
    );

    if (dropped.length > 0) {
      await add(dropped);

      return;
    }

    const item = items.find(
      (each) => each.kind === "text" && each.types.has("text/plain")
    );

    if (item?.kind === "text") insertText(await item.getText("text/plain"));
  }

  const unreadable =
    blind &&
    files.some((pending) => pending.attachment.kind === AttachmentKind.Image);

  return {
    files,
    refused,
    /** The message holds images the conversation's model would not see. */
    unreadable,
    /** Nothing is still being read and the model sees everything, so the message may go. */
    ready: reading === 0 && !unreadable,
    /** Takes files the user picked, as `add` does without waiting for it. */
    pick: (picked: File[]) => void add(picked),
    drop: (event: { items: readonly DropItem[] }) => void drop(event),
    /** Takes the files a paste carries, in place of writing their names. */
    paste: (event: ClipboardEvent<HTMLElement>) => {
      const pasted = [...event.clipboardData.files];

      if (pasted.length === 0) return;

      event.preventDefault();
      void add(pasted);
    },
    remove: (id: string) =>
      hold(held.current.filter((pending) => pending.id !== id)),
    /** Lets every file go once the message carrying them is sent. */
    clear: () => {
      hold([]);
      setRefused([]);
    },
  };
}
