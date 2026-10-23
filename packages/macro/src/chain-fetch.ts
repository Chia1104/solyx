import { X509Certificate } from "node:crypto";
import { connect, getCACertificates } from "node:tls";

import { Agent, fetch as undiciFetch } from "undici";

// Long enough for a government server to answer, short enough not to hold up the calendar.
const TIMEOUT_MS = 15_000;

/** The certificate `host` presents and the addresses it names for its issuer's, read without trusting it. */
function presentedCertificate(host: string) {
  return new Promise<{ certificate: X509Certificate; issuerUrls: string[] }>(
    (resolve, reject) => {
      const socket = connect(
        {
          host,
          port: 443,
          servername: host,
          // Only read to find the issuer; whether the chain is trusted is decided on the request.
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
 * The first certificate downloaded from `urls` that issued `certificate`: a CA whose name it names
 * as its issuer and whose key verifies its signature. Anything else downloaded is passed over.
 */
export async function downloadIssuer(
  certificate: X509Certificate,
  urls: string[],
  fetch: typeof globalThis.fetch = globalThis.fetch
): Promise<X509Certificate> {
  for (const url of urls) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) continue;

    const issuer = new X509Certificate(
      Buffer.from(await response.arrayBuffer())
    );

    if (
      issuer.ca &&
      certificate.checkIssued(issuer) &&
      certificate.verify(issuer.publicKey)
    ) {
      return issuer;
    }
  }

  throw new Error(
    "none of the addresses its certificate names held its issuer"
  );
}

/**
 * `fetch` for a server that presents its certificate without the intermediate that issued it, which
 * a browser downloads and Node does not. The intermediate is downloaded once from where the
 * certificate says it is published and trusted beside Node's roots for these requests alone, so
 * the roots still decide whether the chain holds.
 */
export function fetchCompletingChain(host: string): typeof globalThis.fetch {
  let dispatcher: Promise<Agent> | undefined;

  function agent() {
    if (dispatcher) return dispatcher;

    const created = presentedCertificate(host)
      .then(({ certificate, issuerUrls }) =>
        downloadIssuer(certificate, issuerUrls)
      )
      .then(
        (issuer) =>
          new Agent({
            connect: {
              ca: [...getCACertificates("default"), issuer.toString()],
            },
          })
      );

    // A failed download is tried again on the next request rather than kept.
    void created.catch(() => {
      if (dispatcher === created) dispatcher = undefined;
    });

    dispatcher = created;

    return created;
  }

  return async (input, init) => {
    const request = new Request(input, init);

    // undici's own fetch, since the one Node bundles may be of another version than its Agent.
    const response = await undiciFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      duplex: "half",
      redirect: request.redirect,
      signal: request.signal,
      dispatcher: await agent(),
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
