import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { sha256Hex, signRequest } from "../../src/sigv4.ts";

export interface FakeS3Options {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** How many objects a listing holds before it is continued. */
  pageSize?: number;
}

const SIGNED_ALWAYS = new Set(["host", "x-amz-content-sha256", "x-amz-date"]);

const fromStamp = (stamp: string) =>
  new Date(
    stamp.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6Z"
    )
  );

const header = (request: IncomingMessage, name: string) =>
  [request.headers[name]].flat().join(",");

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * An S3 server in memory, on this computer alone: one bucket addressed in the path, whose every
 * request must carry a signature that holds for what arrived, as a real server checks it, and an
 * upload its length.
 */
export async function startFakeS3(options: FakeS3Options) {
  const { bucket, pageSize = 1000 } = options;
  const objects = new Map<string, Buffer>();
  const paths: string[] = [];

  const signingKey = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
    service: "s3",
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

      paths.push(`${method} ${request.url}`);

      const answer = (status: number, text = "") => {
        response.writeHead(status, { "content-type": "application/xml" });
        response.end(text);
      };

      const fail = (status: number, code: string, message: string) =>
        answer(
          status,
          `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message><RequestId>fake</RequestId></Error>`
        );

      const authorization = header(request, "authorization");
      const payloadHash = header(request, "x-amz-content-sha256");

      const names =
        /SignedHeaders=(?<names>[^,]+)/
          .exec(authorization)
          ?.groups?.names?.split(";") ?? [];

      const expected = signRequest(
        {
          method,
          url,
          headers: Object.fromEntries(
            names
              .filter((name) => !SIGNED_ALWAYS.has(name))
              .map((name) => [name, header(request, name)])
          ),
          payloadHash,
        },
        signingKey,
        fromStamp(header(request, "x-amz-date"))
      );

      if (
        expected.authorization !== authorization ||
        sha256Hex(body) !== payloadHash
      ) {
        fail(
          403,
          "SignatureDoesNotMatch",
          "The request signature we calculated does not match the signature you provided."
        );

        return;
      }

      const [, named, ...rest] = url.pathname.split("/");
      const key = rest.map(decodeURIComponent).join("/");

      if (named !== bucket) {
        fail(404, "NoSuchBucket", "The specified bucket does not exist");

        return;
      }

      if (method === "GET" && key === "") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const after = url.searchParams.get("continuation-token");

        const matching = [...objects.keys()]
          .filter((name) => name.startsWith(prefix))
          .toSorted()
          .filter((name) => after === null || name > after);

        const page = matching.slice(0, pageSize);
        const more = matching.length > page.length;

        answer(
          200,
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
            `<Name>${bucket}</Name><Prefix>${escapeXml(prefix)}</Prefix>`,
            `<KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys>`,
            `<IsTruncated>${more}</IsTruncated>`,
            more
              ? `<NextContinuationToken>${escapeXml(page.at(-1) ?? "")}</NextContinuationToken>`
              : "",
            ...page.map(
              (name) =>
                `<Contents><Key>${escapeXml(name)}</Key><LastModified>2026-10-13T08:00:00.000Z</LastModified><ETag>&quot;${sha256Hex(objects.get(name) ?? "").slice(0, 32)}&quot;</ETag><Size>${objects.get(name)?.length ?? 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`
            ),
            "</ListBucketResult>",
          ].join("\n")
        );

        return;
      }

      if (method === "PUT") {
        if (request.headers["content-length"] === undefined) {
          fail(
            411,
            "MissingContentLength",
            "You must provide the Content-Length HTTP header."
          );

          return;
        }

        objects.set(key, body);
        answer(200);

        return;
      }

      if (method === "DELETE") {
        objects.delete(key);
        answer(204);

        return;
      }

      const found = objects.get(key);

      if (found === undefined) {
        fail(404, "NoSuchKey", "The specified key does not exist.");

        return;
      }

      response.writeHead(200, { "content-length": found.length });
      response.end(found);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  // SAFETY: a server listening on a TCP port has an `AddressInfo`, never a pipe's name.
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    objects,
    /** Each request's method and path as it arrived, encoding and all. */
    paths,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export type FakeS3 = Awaited<ReturnType<typeof startFakeS3>>;
