import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { XMLParser } from "fast-xml-parser";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import { awsEncode, sha256Hex, signRequest } from "./sigv4.ts";

/** The region a server that has none signs with, AWS's first, which R2 and MinIO take for their own. */
export const DEFAULT_REGION = "us-east-1";

/** AWS's own endpoint for a region, where a bucket made there is reached. */
export const awsEndpoint = (region: string) =>
  `https://s3.${region}.amazonaws.com`;

// An upload or a download of a whole backup, which a slow line may take long over; a line gone
// quiet is given up on rather than waited for.
const TRANSFER_TIMEOUT_MS = 60 * 60 * 1000;

const EMPTY_HASH = sha256Hex("");

// Values stay text, so a key made of digits is not read as a number.
const xml = new XMLParser({
  parseTagValue: false,
  isArray: (name) => name === "Contents",
});

/** A body read as XML, which every answer of an S3 server but an object is. */
const xmlSchema = z.string().transform((body, context) => {
  try {
    return xml.parse(body);
  } catch {
    context.addIssue({ code: "custom", message: "Not XML" });

    return z.NEVER;
  }
});

const listingSchema = xmlSchema.pipe(
  z.object({
    ListBucketResult: z.object({
      NextContinuationToken: z.string().min(1).optional(),
      Contents: z
        .array(
          z.object({
            Key: z.string().min(1),
            Size: z.coerce.number().int().nonnegative(),
          })
        )
        .default([]),
    }),
  })
);

// What an S3 server says went wrong, such as `NoSuchBucket` or `SignatureDoesNotMatch`.
const failureSchema = xmlSchema
  .pipe(
    z.object({
      Error: z.object({ Code: z.string(), Message: z.string().optional() }),
    })
  )
  .transform(({ Error: { Code, Message } }) =>
    Message ? `${Code}: ${Message}` : Code
  );

async function fileHash(file: string) {
  const hash = createHash("sha256");

  await pipeline(createReadStream(file), hash);

  return hash.digest("hex");
}

export interface BucketOptions {
  /** The server's address, such as `https://<account>.r2.cloudflarestorage.com`, or `awsEndpoint` of a region. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
  /** @default the computer's clock, which the server refuses a request far from */
  now?: () => Date;
}

export interface BucketObject {
  key: string;
  bytes: number;
}

/**
 * A bucket on any server that speaks S3's API, such as AWS, Cloudflare R2, Backblaze B2 or MinIO.
 * The bucket goes in the path, which all of them serve, and every request is signed with the
 * caller's key, so nothing is read from the environment.
 */
export function createBucket(options: BucketOptions) {
  const { bucket, now = () => new Date() } = options;
  const endpoint = new URL(options.endpoint);
  const root = `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, "")}/${awsEncode(bucket)}`;

  const signingKey = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
    service: "s3",
  };

  const http = ky.create({
    fetch: options.fetch,
    hooks: {
      beforeError: [
        ({ error }) => {
          if (!isHTTPError(error)) {
            error.message = `${endpoint.host}: ${error.message}`;

            return error;
          }

          const reason = failureSchema.safeParse(error.data).data;

          error.message = `${endpoint.host} answered ${error.response.status}${reason ? ` ${reason}` : ""}`;

          return error;
        },
      ],
    },
  });

  const objectUrl = (key: string) =>
    new URL(`${root}/${key.split("/").map(awsEncode).join("/")}`);

  const signed = (method: string, url: URL, payloadHash: string) =>
    signRequest({ method, url, payloadHash }, signingKey, now());

  return {
    /** Uploads a file as the object at `key`, over whatever is there. */
    async put(key: string, file: string): Promise<void> {
      const url = objectUrl(key);

      await http.put(url, {
        headers: signed("PUT", url, await fileHash(file)),
        // Read from the disk as it is sent, and of a known length, which S3 requires.
        body: await openAsBlob(file),
        // An upload cut off is made again whole by whoever asked, signed for that moment.
        retry: 0,
        timeout: false,
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      });
    },

    /** Downloads the object at `key` into a file only this user may read. */
    async get(key: string, file: string): Promise<void> {
      const url = objectUrl(key);

      const { body } = await http.get(url, {
        headers: signed("GET", url, EMPTY_HASH),
        timeout: false,
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      });

      if (!body) throw new Error(`${endpoint.host} sent nothing for ${key}`);

      await pipeline(
        Readable.fromWeb(body),
        createWriteStream(file, { mode: 0o600 })
      );
    },

    /** Deletes the object at `key`; one already gone is no failure. */
    async remove(key: string): Promise<void> {
      const url = objectUrl(key);

      await http.delete(url, { headers: signed("DELETE", url, EMPTY_HASH) });
    },

    /** Every object whose key starts with `prefix`, in the order of their keys. */
    async list(prefix: string): Promise<BucketObject[]> {
      const objects: BucketObject[] = [];

      let token: string | undefined;

      do {
        const query = [
          ["list-type", "2"],
          ["prefix", prefix],
          ...(token === undefined ? [] : [["continuation-token", token]]),
        ];

        const url = new URL(root);

        url.search = query
          .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
          .join("&");

        const { ListBucketResult: page } = listingSchema.parse(
          await http
            .get(url, { headers: signed("GET", url, EMPTY_HASH) })
            .text()
        );

        objects.push(
          ...page.Contents.map(({ Key, Size }) => ({ key: Key, bytes: Size }))
        );
        token = page.NextContinuationToken;
      } while (token !== undefined);

      return objects;
    },
  };
}

export type Bucket = ReturnType<typeof createBucket>;
