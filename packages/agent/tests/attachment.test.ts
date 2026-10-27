import { expect, test } from "vite-plus/test";

import {
  AttachmentImageType,
  AttachmentKind,
  AttachmentRefusal,
  MAX_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  attachmentName,
  imageSize,
  readAttachment,
} from "../src/attachment.ts";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const bytesOf = (...parts: number[][]) => new Uint8Array(parts.flat());

const text = (value: string) => [...value].map((c) => c.charCodeAt(0));

const u16be = (value: number) => [value >> 8, value & 0xff];

const u16le = (value: number) => [value & 0xff, value >> 8];

const u24le = (value: number) => [...u16le(value & 0xffff), value >> 16];

const u32be = (value: number) => [
  ...u16be(value >>> 16),
  ...u16be(value & 0xffff),
];

/** A PNG's signature and header, declaring its size. */
const png = (width: number, height: number) =>
  bytesOf(
    PNG,
    [0, 0, 0, 13],
    text("IHDR"),
    u32be(width),
    u32be(height),
    [8, 6, 0, 0, 0, 0, 0, 0, 0]
  );

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
  expect(readAttachment("chart.txt", png(1200, 800))).toMatchObject({
    kind: AttachmentKind.Image,
    name: "chart.txt",
    mimeType: AttachmentImageType.Png,
    size: 33,
  });

  // Bytes that only start like an image declare no size, so nothing would decode them.
  expect(refusal("chart.png", bytesOf(PNG))).toBe(
    AttachmentRefusal.Unsupported
  );
});

test("an image's size is read from its header before anything decodes it", () => {
  expect(imageSize(png(1200, 800), AttachmentImageType.Png)).toEqual({
    width: 1200,
    height: 800,
  });

  const gif = bytesOf(
    text("GIF89a"),
    u16le(640),
    u16le(480),
    new Array(22).fill(0)
  );

  expect(imageSize(gif, AttachmentImageType.Gif)).toEqual({
    width: 640,
    height: 480,
  });

  // A JFIF segment, then the frame that declares the size.
  const jpeg = bytesOf(
    [0xff, 0xd8, 0xff, 0xe0],
    u16be(16),
    text("JFIF\0"),
    new Array(9).fill(0),
    [0xff, 0xc0],
    u16be(17),
    [8],
    u16be(3024),
    u16be(4032),
    new Array(10).fill(0)
  );

  expect(imageSize(jpeg, AttachmentImageType.Jpeg)).toEqual({
    width: 4032,
    height: 3024,
  });

  const webp = bytesOf(
    text("RIFF"),
    [0, 0, 0, 0],
    text("WEBPVP8X"),
    [10, 0, 0, 0],
    [0, 0, 0, 0],
    u24le(1919),
    u24le(1079)
  );

  expect(imageSize(webp, AttachmentImageType.Webp)).toEqual({
    width: 1920,
    height: 1080,
  });
  expect(readAttachment("photo", webp)).toMatchObject({
    mimeType: AttachmentImageType.Webp,
  });
});

test("an image that declares more pixels than are safe to decode is refused", () => {
  // A few bytes can declare twenty thousand pixels a side, which would take gigabytes to decode.
  expect(refusal("bomb.png", png(20_000, 20_000))).toBe(
    AttachmentRefusal.TooManyPixels
  );
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

  huge.set(png(1000, 1000));

  expect(refusal("huge.png", huge)).toBe(AttachmentRefusal.TooLarge);
});

test("a name keeps no folder and nothing the tag around it would read", () => {
  expect(attachmentName('../../etc/pa"ss.csv')).toBe("_.._etc_pa_ss.csv");
  expect(attachmentName("  .hidden")).toBe("hidden");
  expect(attachmentName("...")).toBe("attachment");
});
