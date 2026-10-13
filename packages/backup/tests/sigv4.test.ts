import { expect, test } from "vite-plus/test";

import { awsEncode, sha256Hex, signRequest } from "../src/sigv4.ts";

// The worked examples of AWS's own documentation, "Signature Calculations for the Authorization
// Header: Transferring Payload in a Single Chunk", whose key is published there for this purpose.
const key = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "s3",
};

const at = new Date("2013-05-24T00:00:00Z");

const empty = sha256Hex("");

const signatureOf = (headers: Record<string, string>) =>
  /Signature=(?<signature>[0-9a-f]+)$/.exec(headers.authorization ?? "")?.groups
    ?.signature;

test("an object read is signed as AWS's example is, its range among the signed headers", () => {
  const headers = signRequest(
    {
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadHash: empty,
    },
    key,
    at
  );

  expect(headers.authorization).toBe(
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
  );
  expect(headers["x-amz-date"]).toBe("20130524T000000Z");
});

test("a query is signed sorted, a name without a value as an empty one", () => {
  const listing = signRequest(
    {
      method: "GET",
      url: new URL(
        "https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2"
      ),
      payloadHash: empty,
    },
    key,
    at
  );

  const lifecycle = signRequest(
    {
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/?lifecycle"),
      payloadHash: empty,
    },
    key,
    at
  );

  expect(signatureOf(listing)).toBe(
    "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"
  );
  expect(signatureOf(lifecycle)).toBe(
    "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"
  );
});

test("an upload is signed over its body's hash and a path encoded as AWS encodes it", () => {
  const headers = signRequest(
    {
      method: "PUT",
      url: new URL(
        `https://examplebucket.s3.amazonaws.com/${awsEncode("test$file.text")}`
      ),
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      payloadHash: sha256Hex("Welcome to Amazon S3."),
    },
    key,
    at
  );

  expect(signatureOf(headers)).toBe(
    "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
  );
});

test("every character AWS reserves is encoded, which encodeURIComponent alone leaves", () => {
  expect(awsEncode("a b/c!'()*~-_.")).toBe("a%20b%2Fc%21%27%28%29%2A~-_.");
});
