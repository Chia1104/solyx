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

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { AttachmentKind } from "@solyx/agent/attachment";

import {
  keepAttachments,
  keptAttachment,
} from "../src/modules/agent/attachments.ts";

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
      1
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
      keepAttachments(workspace, [new File(["a,b\n"], "fills.csv")], 1)
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
    keepAttachments(workspace, [new File(["a,b\n"], "fills.csv")], 1)
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
