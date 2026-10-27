import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { AttachmentKind } from "@solyx/agent/attachment";

import {
  attachmentText,
  keepAttachments,
  keptAttachment,
} from "../src/modules/agent/attachments.ts";
import { createPdfThreads } from "../src/modules/agent/pdf-threads.ts";

// The thread's own entry, which the app builds beside its bundle, and pdf.js's CMaps it ships.
const pdfs = createPdfThreads({
  worker: new URL("../src/worker/pdf.ts", import.meta.url),
  cmaps: fileURLToPath(
    new URL("cmaps/", import.meta.resolve("pdfjs-dist/package.json"))
  ),
});

/** A PDF of one page holding `content`, its font named by `font`, made by hand so the test needs no writer. */
function pdf(content: string, font: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...font.split("\n"),
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((object, at) => {
    offsets.push(body.length);
    body += `${at + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = body.length;

  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .map((at) => `${String(at).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

// A Chinese font the file only names, its codes read through the predefined CMap UniCNS-UCS2-H,
// as older Chinese documents are made: without pdf.js's CMaps it reads as nothing.
const MING = [
  "<< /Type /Font /Subtype /Type0 /BaseFont /MingLiU /Encoding /UniCNS-UCS2-H /DescendantFonts [6 0 R] >>",
  "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MingLiU /CIDSystemInfo << /Registry (Adobe) /Ordering (CNS1) /Supplement 0 >> /FontDescriptor 7 0 R >>",
  "<< /Type /FontDescriptor /FontName /MingLiU /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>",
].join("\n");

// 台積電, as UCS-2 codes.
const REPORT = pdf("BT /F1 24 Tf 72 700 Td <53F07A4D96FB> Tj ET", MING);

// A page that draws nothing, as a scan's would hold only its image.
const SCAN = pdf("", MING);

const noPdfs = { pages: vi.fn() };

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "solyx-attachments-"));
});

afterEach(() => rm(workspace, { recursive: true, force: true }));

// One transparent pixel.
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  )
);

test("a message's files are kept as attached, in a folder of the message's own", async () => {
  const kept = await keepAttachments(
    workspace,
    [
      new File([PNG], "image.png"),
      new File([PNG], "image.png"),
      new File(["date,close\n"], "../收盤.csv"),
    ],
    1_700_000_000_000,
    noPdfs
  );

  expect(kept.attachments).toMatchObject([
    {
      kind: AttachmentKind.Image,
      name: "image.png",
      path: "attachments/1700000000000/image.png",
    },
    { name: "image (2).png", path: "attachments/1700000000000/image (2).png" },
    {
      kind: AttachmentKind.Text,
      name: "_收盤.csv",
      path: "attachments/1700000000000/_收盤.csv",
      text: "date,close\n",
    },
  ]);

  const folder = join(workspace, "attachments", "1700000000000");

  expect((await readdir(folder)).sort()).toEqual(
    ["_收盤.csv", "image (2).png", "image.png"].sort()
  );
  expect(new Uint8Array(await readFile(join(folder, "image.png")))).toEqual(
    PNG
  );

  const shown = await keptAttachment(
    workspace,
    "attachments/1700000000000/_收盤.csv"
  );

  expect([shown.name, shown.type, await shown.text()]).toEqual([
    "_收盤.csv",
    "text/csv",
    "date,close\n",
  ]);

  // A message that was not sent takes its files away again.
  await kept.remove();

  expect(existsSync(folder)).toBe(false);
});

test("a file that cannot ride with a message keeps none of them", async () => {
  await expect(
    keepAttachments(
      workspace,
      [
        new File([PNG], "chart.png"),
        new File(["-----BEGIN RSA PRIVATE KEY-----\nMIIE\n"], "fubon.pem"),
      ],
      1,
      noPdfs
    )
  ).rejects.toThrow("fubon.pem holds a private key or a certificate");

  expect(await readdir(workspace)).toEqual([]);
});

test("files are never written through a link the conversation's commands made", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "solyx-elsewhere-"));

  try {
    // A command in the conversation's folder points its attachments somewhere else.
    await symlink(elsewhere, join(workspace, "attachments"));

    await expect(
      keepAttachments(workspace, [new File(["a,b\n"], "fills.csv")], 1, noPdfs)
    ).rejects.toThrow("not in its conversation's folder");

    expect(await readdir(elsewhere)).toEqual([]);
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("nothing already at a message's place is written over", async () => {
  await mkdir(join(workspace, "attachments", "1"), { recursive: true });
  await symlink("/etc/hosts", join(workspace, "attachments", "1", "fills.csv"));

  await expect(
    keepAttachments(workspace, [new File(["a,b\n"], "fills.csv")], 1, noPdfs)
  ).rejects.toThrow(/EEXIST/);
});

test("a kept file is read only where it really is in the conversation's folder", async () => {
  await mkdir(join(workspace, "attachments", "2"), { recursive: true });
  // A command leaves a link where a kept file would be, to a file outside the folder.
  await symlink("/etc/hosts", join(workspace, "attachments", "2", "hosts.txt"));

  await expect(
    keptAttachment(workspace, "attachments/2/hosts.txt")
  ).rejects.toThrow("not in its conversation's folder");
});

test("a PDF is kept with the text read of it, Chinese set in a CMap'd font among it, which read_attachment reads back", async () => {
  const kept = await keepAttachments(
    workspace,
    [new File([REPORT], "法說會.pdf")],
    3,
    pdfs
  );

  expect(kept.attachments).toEqual([
    {
      kind: AttachmentKind.Text,
      name: "法說會.pdf",
      path: "attachments/3/法說會.pdf",
      size: REPORT.byteLength,
      mimeType: "application/pdf",
      text: "[page 1]\n台積電",
      pages: 1,
    },
  ]);

  expect(await attachmentText(workspace, "attachments/3/法說會.pdf")).toBe(
    "[page 1]\n台積電"
  );
  expect(
    await readFile(
      join(workspace, "attachments", "3", ".text", "法說會.pdf.txt"),
      "utf8"
    )
  ).toBe("[page 1]\n台積電");
});

test("a PDF with no text keeps nothing of its message, and says to attach its pages as images", async () => {
  await expect(
    keepAttachments(
      workspace,
      [new File(["a,b\n"], "fills.csv"), new File([SCAN], "scan.pdf")],
      4,
      pdfs
    )
  ).rejects.toThrow("scan.pdf holds no text to read");

  expect(await readdir(workspace)).toEqual([]);
});

test("read_attachment reads a text file's own text, never an image or a path it was not handed", async () => {
  await keepAttachments(
    workspace,
    [
      new File(["date,close\n1,2\n"], "fills.csv"),
      new File([PNG], "chart.png"),
    ],
    5,
    noPdfs
  );

  expect(await attachmentText(workspace, "attachments/5/fills.csv")).toBe(
    "date,close\n1,2\n"
  );
  await expect(
    attachmentText(workspace, "attachments/5/chart.png")
  ).rejects.toThrow("is an image");
  await expect(
    attachmentText(workspace, "attachments/5/.text/fills.csv.txt")
  ).rejects.toThrow("is not where a message's file is kept");
});
