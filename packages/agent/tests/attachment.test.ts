import { expect, test } from "vite-plus/test";

import {
  AttachmentImageType,
  AttachmentKind,
  AttachmentRefusal,
  MAX_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  attachmentName,
  readAttachment,
} from "../src/attachment.ts";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const utf8 = (text: string) => new TextEncoder().encode(text);

const refusal = (name: string, bytes: Uint8Array) => {
  try {
    readAttachment(name, bytes);
  } catch (error) {
    return error instanceof Error && "reason" in error
      ? error.reason
      : undefined;
  }

  return undefined;
};

test("an image is told by its bytes, whatever its name says", () => {
  expect(
    readAttachment("chart.txt", new Uint8Array([...PNG, 1, 2, 3]))
  ).toMatchObject({
    kind: AttachmentKind.Image,
    name: "chart.txt",
    mimeType: AttachmentImageType.Png,
    size: 11,
  });

  const webp = utf8("RIFF\0\0\0\0WEBPVP8 ");

  expect(readAttachment("photo", webp)).toMatchObject({
    mimeType: AttachmentImageType.Webp,
  });
});

test("text takes its type from its name and keeps what it says", () => {
  expect(readAttachment("fills.CSV", utf8("date,price\n1,2"))).toEqual({
    kind: AttachmentKind.Text,
    name: "fills.CSV",
    size: 14,
    mimeType: "text/csv",
    text: "date,price\n1,2",
  });

  expect(readAttachment("notes", utf8("台積電"))).toMatchObject({
    mimeType: "text/plain",
    text: "台積電",
  });
});

test("a file is refused when the model could not read it or it holds a key", () => {
  expect(refusal("data.bin", new Uint8Array([0, 1, 0xff, 0xfe]))).toBe(
    AttachmentRefusal.Unsupported
  );

  expect(
    refusal(
      "id_ed25519",
      utf8("-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbg==\n")
    )
  ).toBe(AttachmentRefusal.Secret);

  expect(refusal("cert.pem", utf8("-----BEGIN CERTIFICATE-----\nMIIB\n"))).toBe(
    AttachmentRefusal.Secret
  );
});

test("a file past the limits is refused for the limit it passed", () => {
  const long = new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES + 1).fill(0x61);

  expect(refusal("big.csv", long)).toBe(AttachmentRefusal.TooLong);

  // An archive is no text however long, so it is refused as a kind the model cannot read.
  const archive = new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES + 1);

  expect(refusal("big.zip", archive)).toBe(AttachmentRefusal.Unsupported);

  const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);

  huge.set(PNG);

  expect(refusal("huge.png", huge)).toBe(AttachmentRefusal.TooLarge);
});

test("a name keeps no folder and nothing the tag around it would read", () => {
  expect(attachmentName('../../etc/pa"ss.csv')).toBe("_.._etc_pa_ss.csv");
  expect(attachmentName("  .hidden")).toBe("hidden");
  expect(attachmentName("...")).toBe("attachment");
});
