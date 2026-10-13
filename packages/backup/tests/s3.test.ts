import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { awsEndpoint, createBucket } from "../src/s3.ts";
import type { BucketOptions } from "../src/s3.ts";

import { startFakeS3 } from "./fixtures/fake-s3.ts";
import type { FakeS3 } from "./fixtures/fake-s3.ts";

const account = {
  bucket: "solyx-backups",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

let directory: string;

let server: FakeS3;

const bucket = (options: Partial<BucketOptions> = {}) =>
  createBucket({ ...account, endpoint: server.endpoint, ...options });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-s3-"));
  server = await startFakeS3({ ...account, pageSize: 2 });
});

afterEach(async () => {
  await server.close();
  await rm(directory, { recursive: true, force: true });
});

test("a file goes up and comes back as it was, its key encoded as it was signed", async () => {
  const source = join(directory, "source");
  const copy = join(directory, "copy");
  const key = "solyx dev/備份 (1)/20261013T080000Z.solyx-backup";

  await writeFile(source, Buffer.alloc(200_000, "sealed bytes "));

  await bucket().put(key, source);
  await bucket().get(key, copy);

  expect(server.objects.get(key)).toEqual(await readFile(source));
  expect(await readFile(copy)).toEqual(await readFile(source));
  expect((await stat(copy)).mode & 0o777).toBe(0o600);
  expect(server.paths[0]).toBe(
    "PUT /solyx-backups/solyx%20dev/%E5%82%99%E4%BB%BD%20%281%29/20261013T080000Z.solyx-backup"
  );
});

test("a listing follows its continuations and keeps a key of digits as text", async () => {
  for (const key of ["a/1", "a/2", "a/3", "a/20261013", "b/1"]) {
    server.objects.set(key, Buffer.alloc(key.length));
  }

  await expect(bucket().list("a/")).resolves.toEqual([
    { key: "a/1", bytes: 3 },
    { key: "a/2", bytes: 3 },
    { key: "a/20261013", bytes: 10 },
    { key: "a/3", bytes: 3 },
  ]);
  await expect(bucket().list("c/")).resolves.toEqual([]);
  expect(server.paths.slice(0, 2)).toEqual([
    "GET /solyx-backups?list-type=2&prefix=a%2F",
    "GET /solyx-backups?list-type=2&prefix=a%2F&continuation-token=a%2F2",
  ]);
});

test("a server under a path keeps it before the bucket", async () => {
  const under = bucket({ endpoint: `${server.endpoint}/` });

  server.objects.set("a/1", Buffer.from("x"));

  await expect(under.list("a/")).resolves.toHaveLength(1);
});

test("a refusal names the server and the reason it gives", async () => {
  const source = join(directory, "source");

  await writeFile(source, "sealed");

  await expect(
    bucket({ secretAccessKey: "another secret" }).put("a/1", source)
  ).rejects.toThrow(
    `${server.host} answered 403 SignatureDoesNotMatch: The request signature we calculated does not match the signature you provided.`
  );
  await expect(bucket({ bucket: "elsewhere" }).list("a/")).rejects.toThrow(
    `${server.host} answered 404 NoSuchBucket: The specified bucket does not exist`
  );
  await expect(
    bucket().get("a/missing", join(directory, "copy"))
  ).rejects.toThrow(`${server.host} answered 404 NoSuchKey`);
  await expect(stat(join(directory, "copy"))).rejects.toThrow("ENOENT");
});

test("a server that cannot be reached is named too", async () => {
  await server.close();

  await expect(bucket().list("a/")).rejects.toThrow(`${server.host}: `);
});

test("a clock the server would refuse is the caller's to set", async () => {
  const at = new Date("2026-10-13T08:00:00Z");

  server.objects.set("a/1", Buffer.from("x"));

  await expect(bucket({ now: () => at }).list("a/")).resolves.toHaveLength(1);
});

test("AWS's endpoint is its region's", () => {
  expect(awsEndpoint("ap-northeast-1")).toBe(
    "https://s3.ap-northeast-1.amazonaws.com"
  );
});
