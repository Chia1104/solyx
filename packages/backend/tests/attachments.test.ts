import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { AttachmentKind } from "@solyx/agent/attachment";

import { keepAttachments } from "../src/modules/agent/attachments.ts";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "solyx-attachments-"));
});

afterEach(() => rm(workspace, { recursive: true, force: true }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("a message's files are kept as attached, in a folder of the message's own", async () => {
  const kept = await keepAttachments(
    workspace,
    [
      new File([PNG], "image.png"),
      new File([PNG], "image.png"),
      new File(["date,close\n"], "../收盤.csv"),
    ],
    1_700_000_000_000
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
      1
    )
  ).rejects.toThrow("fubon.pem holds a private key or a certificate");

  expect(await readdir(workspace)).toEqual([]);
});
