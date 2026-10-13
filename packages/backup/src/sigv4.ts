import { createHash, createHmac } from "node:crypto";

export interface SigningKey {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface UnsignedRequest {
  method: string;
  url: URL;
  /** The headers to sign beside the host, the date and the payload's hash, by lowercase name. */
  headers?: Record<string, string>;
  /** The body's SHA-256 in hex. */
  payloadHash: string;
}

const hmac = (key: string | Buffer, text: string) =>
  createHmac("sha256", key).update(text).digest();

export const sha256Hex = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

/** URI encoding as Signature Version 4 has it: every byte but A–Z, a–z, 0–9, `-`, `_`, `.` and `~`. */
export function awsEncode(text: string) {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalQuery(url: URL) {
  return [...url.searchParams]
    .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
    .toSorted()
    .join("&");
}

/**
 * The headers that carry a request to an S3 server, signed with AWS Signature Version 4: the
 * caller's own, the date, the payload's hash and the `authorization` over them all and the host.
 * The URL's path is signed as it is written, so its caller encodes it.
 */
export function signRequest(
  { method, url, headers = {}, payloadHash }: UnsignedRequest,
  key: SigningKey,
  at: Date
) {
  const stamp = at.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);

  const sent = {
    ...headers,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };

  const signed = Object.entries({ ...sent, host: url.host })
    .map(([name, value]): [string, string] => [
      name.toLowerCase(),
      value.trim(),
    ])
    .toSorted(([a], [b]) => (a < b ? -1 : 1));

  const names = signed.map(([name]) => name).join(";");

  const request = [
    method,
    url.pathname,
    canonicalQuery(url),
    ...signed.map(([name, value]) => `${name}:${value}`),
    "",
    names,
    payloadHash,
  ].join("\n");

  const scope = `${day}/${key.region}/${key.service}/aws4_request`;

  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(request)].join(
    "\n"
  );

  const signingKey = [key.region, key.service, "aws4_request"].reduce(
    (secret, part) => hmac(secret, part),
    hmac(`AWS4${key.secretAccessKey}`, day)
  );

  const signature = hmac(signingKey, toSign).toString("hex");

  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
  };
}
