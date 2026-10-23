import { X509Certificate } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { connect, getCACertificates } from "node:tls";

import { Agent, request, fetch as undiciFetch } from "undici";

// Long enough for a government server to answer, short enough not to hold up the calendar.
const TIMEOUT_MS = 15_000;

// A certificate is a few kilobytes; anything much larger is not one.
const MAX_CERTIFICATE_BYTES = 64 * 1024;

/**
 * This computer's and its networks' addresses. The address a certificate names for its issuer is
 * read before the certificate is trusted, so it may not lead to a service only this computer reaches.
 */
const LOCAL_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  LOCAL_ADDRESSES.addSubnet(network, prefix, "ipv4");
}

// An IPv4-mapped address is checked against the IPv4 rules above.
for (const [network, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  LOCAL_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

const isLocal = (ip: string) =>
  LOCAL_ADDRESSES.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");

/** The certificate `host` presents and the addresses it names for its issuer's, read without trusting it. */
function presentedCertificate(host: string) {
  return new Promise<{ certificate: X509Certificate; issuerUrls: string[] }>(
    (resolve, reject) => {
      const socket = connect(
        {
          host,
          port: 443,
          servername: host,
          // Only read to find the issuer; whether the chain holds is decided on each request.
          rejectUnauthorized: false,
          timeout: TIMEOUT_MS,
        },
        () => {
          const peer = socket.getPeerCertificate();

          socket.end();
          resolve({
            certificate: new X509Certificate(peer.raw),
            issuerUrls: peer.infoAccess?.["CA Issuers - URI"] ?? [],
          });
        }
      );

      socket.once("timeout", () =>
        socket.destroy(new Error(`${host} did not answer`))
      );
      socket.once("error", reject);
    }
  );
}

/**
 * The certificate at `url`, an `http:` address as issuers' are, read from the public address its
 * host resolves to with no redirect followed; `null` where it holds none.
 */
export async function downloadCertificate(
  url: string
): Promise<X509Certificate | null> {
  const address = new URL(url);

  if (address.protocol !== "http:") {
    throw new Error(`${url} is not an http address`);
  }

  // Resolved once and connected to by number, so the name cannot point elsewhere in between.
  const hostname = address.hostname.replace(/^\[|\]$/g, "");

  const ips = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true })).map((found) => found.address);

  const [ip] = ips;

  if (ip === undefined || ips.some(isLocal)) {
    throw new Error(`${address.host} is on this computer or its network`);
  }

  const target = new URL(address);

  target.hostname = isIP(ip) === 6 ? `[${ip}]` : ip;

  const { statusCode, body } = await request(target, {
    headers: { host: address.host },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (statusCode !== 200) {
    body.destroy();

    return null;
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of body) {
    size += chunk.length;

    if (size > MAX_CERTIFICATE_BYTES) {
      body.destroy();

      return null;
    }

    chunks.push(chunk);
  }

  try {
    return new X509Certificate(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

/** `certificate` names `issuer` as its issuer, and `issuer`'s key verifies its signature. */
const issued = (issuer: X509Certificate, certificate: X509Certificate) =>
  certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey);

/**
 * The first certificate downloaded from `urls` that issued `certificate` and that one of `roots`
 * issued in turn, so trusting it completes a chain to a root rather than standing in for one.
 * Anything else downloaded is passed over.
 */
export async function downloadIssuer(
  certificate: X509Certificate,
  urls: string[],
  roots: X509Certificate[],
  download = downloadCertificate
): Promise<X509Certificate> {
  for (const url of urls) {
    const issuer = await download(url);

    if (
      issuer?.ca &&
      issued(issuer, certificate) &&
      roots.some((root) => issued(root, issuer))
    ) {
      return issuer;
    }
  }

  throw new Error(
    "none of the addresses its certificate names held an issuer a trusted root issued"
  );
}

/**
 * `fetch` for a server that presents its certificate without the intermediate that issued it, which
 * a browser downloads and Node does not. The intermediate is downloaded once from where the
 * certificate says it is published, kept only once one of Node's roots issued it, and trusted
 * beside those roots for these requests alone.
 */
export function fetchCompletingChain(host: string): typeof globalThis.fetch {
  let completed: Promise<Agent> | undefined;

  function agent() {
    if (completed) return completed;

    const roots = getCACertificates("default");

    const created = presentedCertificate(host)
      .then(({ certificate, issuerUrls }) =>
        downloadIssuer(
          certificate,
          issuerUrls,
          roots.map((pem) => new X509Certificate(pem))
        )
      )
      .then(
        (issuer) =>
          new Agent({ connect: { ca: [...roots, issuer.toString()] } })
      );

    // A failed download is tried again on the next request rather than kept.
    void created.catch(() => {
      if (completed === created) completed = undefined;
    });

    completed = created;

    return created;
  }

  return async (input, init) => {
    const sent = new Request(input, init);

    // Requests made together share one download, so each fails with an error of its own, which
    // its caller may rewrite.
    const dispatcher = await agent().catch((cause: Error) => {
      throw new Error(cause.message, { cause });
    });

    // undici's own fetch, since the one Node bundles may be of another version than its Agent.
    const response = await undiciFetch(sent.url, {
      method: sent.method,
      headers: sent.headers,
      body: sent.body,
      duplex: "half",
      redirect: sent.redirect,
      signal: sent.signal,
      dispatcher,
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
