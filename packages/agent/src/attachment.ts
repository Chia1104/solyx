/**
 * What a message may carry beside its text, and the reading of a file that says whether it may.
 * It imports nothing from pi or Node, so the renderer refuses a file before sending it, and the
 * host again as it arrives, on the same rules.
 */

/** The most files one message carries. */
export const MAX_ATTACHMENTS = 5;

/** The largest file a message carries, before an image is scaled to fit its model. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** The most text a file adds to its message, since the model reads all of it with every request. */
export const MAX_TEXT_ATTACHMENT_BYTES = 100 * 1024;

/** The images a message carries to its model, told apart by their first bytes rather than their names. */
export const AttachmentImageType = {
  Png: "image/png",
  Jpeg: "image/jpeg",
  Gif: "image/gif",
  Webp: "image/webp",
} as const;

export type AttachmentImageType =
  (typeof AttachmentImageType)[keyof typeof AttachmentImageType];

export const AttachmentKind = {
  Image: "image",
  Text: "text",
} as const;

export type AttachmentKind =
  (typeof AttachmentKind)[keyof typeof AttachmentKind];

/** A file a user message carried, as the thread lists it. */
export interface AttachmentView {
  /** Where the conversation's folder keeps it as it was attached. */
  path: string;
  name: string;
  /** The type the app read from its bytes. */
  mimeType: string;
  /** Bytes as attached, before an image was scaled to fit the model. */
  size: number;
}

/** A file read for a message: an image the model sees, or text it reads. */
export type ReadAttachment = {
  name: string;
  size: number;
} & (
  | {
      kind: typeof AttachmentKind.Image;
      mimeType: AttachmentImageType;
      data: Uint8Array;
    }
  | { kind: typeof AttachmentKind.Text; mimeType: string; text: string }
);

/** Why a file cannot ride with a message. */
export const AttachmentRefusal = {
  TooLarge: "too-large",
  /** Neither an image the model takes nor text. */
  Unsupported: "unsupported",
  /** Text longer than a message holds. */
  TooLong: "too-long",
  /** A private key or a certificate, which would be kept with the conversation and its backups. */
  Secret: "secret",
} as const;

export type AttachmentRefusal =
  (typeof AttachmentRefusal)[keyof typeof AttachmentRefusal];

const REFUSAL_TEXT: Record<AttachmentRefusal, string> = {
  [AttachmentRefusal.TooLarge]: `is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
  [AttachmentRefusal.Unsupported]:
    "is neither a PNG, JPEG, GIF or WebP image nor text",
  [AttachmentRefusal.TooLong]: `holds more than ${MAX_TEXT_ATTACHMENT_BYTES / 1024} KB of text`,
  [AttachmentRefusal.Secret]: "holds a private key or a certificate",
};

export class AttachmentRefused extends Error {
  readonly file: string;
  readonly reason: AttachmentRefusal;

  constructor(file: string, reason: AttachmentRefusal) {
    super(`${file} ${REFUSAL_TEXT[reason]}, so it cannot be attached`);
    this.name = "AttachmentRefused";
    this.file = file;
    this.reason = reason;
  }
}

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, at) => bytes[at] === byte);

const IMAGE_SIGNATURES: readonly [
  AttachmentImageType,
  (bytes: Uint8Array) => boolean,
][] = [
  [
    AttachmentImageType.Png,
    (bytes) =>
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ],
  [AttachmentImageType.Jpeg, (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff])],
  [
    AttachmentImageType.Gif,
    (bytes) => startsWith(bytes, [0x47, 0x49, 0x46, 0x38]),
  ],
  [
    AttachmentImageType.Webp,
    (bytes) =>
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  ],
];

// PEM's armour, OpenSSH's and PuTTY's keys; a binary key or certificate never reads as text.
const SECRET =
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----|PuTTY-User-Key-File-/;

const TEXT_TYPES = new Map([
  ["csv", "text/csv"],
  ["tsv", "text/tab-separated-values"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["json", "application/json"],
]);

// What a path, a shell or the attachment's tag would read as more than a name.
const UNSAFE = '"<>\\/:*?|';

/** How much of a file too long to attach is read to tell text from the rest. */
const SNIFF_BYTES = 4096;

/** Text in UTF-8 without a NUL, or `undefined`; `prefix` reads a beginning cut anywhere. */
function textOf(bytes: Uint8Array, prefix = false) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
      stream: prefix,
    });

    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

/**
 * A file's name as the conversation's folder keeps it and the model reads it: a name alone, with
 * nothing a path, a shell or the tag around it would read as more.
 */
export function attachmentName(name: string) {
  const cleaned = [...name.normalize("NFC")]
    .map((character) =>
      character < " " || character === "\u007f" || UNSAFE.includes(character)
        ? "_"
        : character
    )
    .join("")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 120);

  return cleaned || "attachment";
}

/** Reads a file for a message, or throws `AttachmentRefused` with why it cannot ride with one. */
export function readAttachment(
  name: string,
  bytes: Uint8Array
): ReadAttachment {
  const kept = attachmentName(name);

  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRefused(kept, AttachmentRefusal.TooLarge);
  }

  const image = IMAGE_SIGNATURES.find(([, matches]) => matches(bytes));

  if (image) {
    return {
      kind: AttachmentKind.Image,
      name: kept,
      size: bytes.byteLength,
      mimeType: image[0],
      data: bytes,
    };
  }

  if (bytes.byteLength > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new AttachmentRefused(
      kept,
      textOf(bytes.subarray(0, SNIFF_BYTES), true) === undefined
        ? AttachmentRefusal.Unsupported
        : AttachmentRefusal.TooLong
    );
  }

  const text = textOf(bytes);

  if (text === undefined) {
    throw new AttachmentRefused(kept, AttachmentRefusal.Unsupported);
  }

  if (SECRET.test(text)) {
    throw new AttachmentRefused(kept, AttachmentRefusal.Secret);
  }

  const extension = kept.includes(".")
    ? kept.slice(kept.lastIndexOf(".") + 1).toLowerCase()
    : "";

  return {
    kind: AttachmentKind.Text,
    name: kept,
    size: bytes.byteLength,
    mimeType: TEXT_TYPES.get(extension) ?? "text/plain",
    text,
  };
}
