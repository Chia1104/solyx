import { X509Certificate } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "vite-plus/test";

import { downloadCertificate, downloadIssuer } from "../src/chain-fetch.ts";

// Synthetic certificates made for these tests, with no key kept: a server's, issued by an
// intermediate that a root issued, and a rogue CA's own.

/** The root that issued `INTERMEDIATE`. */
const ROOT = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBdDCCARqgAwIBAgIUKt1On2vU+8K8NE2LJX4R3BNCgaUwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMRXhhbXBsZSBSb290MCAXDTI2MTAyMzAzMzc1NloYDzIxMjYw
OTI5MDMzNzU2WjAXMRUwEwYDVQQDDAxFeGFtcGxlIFJvb3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAATJDuEnwgD7RXsOB2ED5nEapoJSvD37TGwlBdONLslvOiPB
FAcN+hQDWwLx/h9J1gLZqk0lHhBLU7ktQgzjuyNFo0IwQDAdBgNVHQ4EFgQUzSQO
83XJpjD3d840n2J4fozseNwwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AQYwCgYIKoZIzj0EAwIDSAAwRQIgQldD0KAH/+tGDGq5dFzUSAPqwW64cSSvDpCe
CeLsOJ8CIQCWLSx1gXETfKzvE65EYyntHe/3NKZyxtdv1QwHTI+NXw==
-----END CERTIFICATE-----`);

/** The CA that issued `LEAF`. */
const INTERMEDIATE = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBYDCCAQagAwIBAgIURiL8pT7CzdUjgGaWSYwamcaymJIwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMRXhhbXBsZSBSb290MCAXDTI2MTAyMzAzMzc1NloYDzIxMjYw
OTI5MDMzNzU2WjAfMR0wGwYDVQQDDBRFeGFtcGxlIEludGVybWVkaWF0ZTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABI+HitXpYTywpmHWxwBLUL4qnw3ooFasAakk
y/aiYfjt8n2NVOH4OaQbblFbiv/k7wRa8a3Fc0STU4sCF2Ob22CjJjAkMBIGA1Ud
EwEB/wQIMAYBAf8CAQAwDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0gAMEUC
IG/u5x/ngeJQ76FUAXKOImqzNnnhaD2ubO0b8xs7onWUAiEAoA2PJgbLSarmqKrH
6lRMG05lcx88985JXS5a6+CYF2U=
-----END CERTIFICATE-----`);

/** `INTERMEDIATE`'s name and key on a certificate that may not issue others. */
const NOT_A_CA = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBWzCCAQCgAwIBAgIURiL8pT7CzdUjgGaWSYwamcaymJMwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMRXhhbXBsZSBSb290MCAXDTI2MTAyMzAzMzc1NloYDzIxMjYw
OTI5MDMzNzU2WjAfMR0wGwYDVQQDDBRFeGFtcGxlIEludGVybWVkaWF0ZTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABI+HitXpYTywpmHWxwBLUL4qnw3ooFasAakk
y/aiYfjt8n2NVOH4OaQbblFbiv/k7wRa8a3Fc0STU4sCF2Ob22CjIDAeMAwGA1Ud
EwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMAoGCCqGSM49BAMCA0kAMEYCIQDHgK6V
f2CAqo/wpTv/JrimL84i1Z7L+BfLhCFYz445BAIhAJukvl8ZkJcM+VPd7EkV0XY2
KEltpL5NZoQ3zVQdt196
-----END CERTIFICATE-----`);

/** A CA of `INTERMEDIATE`'s name with a key of its own. */
const IMPOSTOR = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBhDCCASqgAwIBAgIUKnFswolV3zWSrz6z+xKvLCqxW8wwCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwURXhhbXBsZSBJbnRlcm1lZGlhdGUwIBcNMjYxMDIzMDMzNzU2
WhgPMjEyNjA5MjkwMzM3NTZaMB8xHTAbBgNVBAMMFEV4YW1wbGUgSW50ZXJtZWRp
YXRlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExqPqXpoAy7Y50AOKGbsnXuNk
RMLXR8WqoQZ6BA0Y9jgXenQ61iPftlAv9YGm010YGEcCwo5u0IuutAbBPJlBeqNC
MEAwHQYDVR0OBBYEFA76YHNlno/dTr9qIc9QYElSAs8LMA8GA1UdEwEB/wQFMAMB
Af8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0gAMEUCIQDWM+AfXOK+VOfP
EBNitcCaIECPjY5JYlswUj+cd9YQ6wIgLe7YXXjwdip6NYRlCmAqqx3ZNWMrvdoB
Zmz0yCVe9L0=
-----END CERTIFICATE-----`);

/** The server's certificate. */
const LEAF = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBZDCCAQmgAwIBAgIUWRVVFmtvYX5D43q6plvYkK8EIMYwCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwURXhhbXBsZSBJbnRlcm1lZGlhdGUwIBcNMjYxMDIzMDMzNzU2
WhgPMjEyNjA5MjkwMzM3NTZaMBcxFTATBgNVBAMMDGV4YW1wbGUudGVzdDBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABI+vSj6caQccKKVTw8SQlA1wtc2qpfmb8LdX
CslkBzZvHYUzYpOsLkBJ3NIlbwBqMISRY8enMHzdDtr9GjLUVDmjKTAnMAwGA1Ud
EwEB/wQCMAAwFwYDVR0RBBAwDoIMZXhhbXBsZS50ZXN0MAoGCCqGSM49BAMCA0kA
MEYCIQCKdjT2RBK+y1yeaATwpZpuSe3YWT1awaK08DHhaP1LegIhAPgYC8H+iBpj
yxTe3uRK0qpnPxF8Kq/IJj/mKHq0gVc8
-----END CERTIFICATE-----`);

/** A CA of its own, which no root issued. */
const ROGUE_CA = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBbDCCARKgAwIBAgIUAcuTmGqOoEH4aGwC3I+aN6kMSrAwCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwIUm9ndWUgQ0EwIBcNMjYxMDIzMDMzNzU2WhgPMjEyNjA5Mjkw
MzM3NTZaMBMxETAPBgNVBAMMCFJvZ3VlIENBMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAE8naiz6fDCRXYgHTAF1WY6nDVhp9kCODfCNsuUada4c3u9IZZ5jftkXkI
f5Cm8mZEvZ++MichvbXG2C9Ug9JdI6NCMEAwHQYDVR0OBBYEFOxVuP6zlLYpMR/C
Jltnz7xfgVWpMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqG
SM49BAMCA0gAMEUCIQCGSLBY27SsKze3yVWjFsTNdHwvVirLRfUgeYuPGDjVywIg
Rm1cW21HJ1JYMxg6eJOfl/omaQr/bztgla229AG2ZRA=
-----END CERTIFICATE-----`);

/** A certificate of the server's name, issued by `ROGUE_CA`. */
const ROGUE_LEAF = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBVjCB/aADAgECAhRcuTqscM/JXIZdF3Ciow8QqavACjAKBggqhkjOPQQDAjAT
MREwDwYDVQQDDAhSb2d1ZSBDQTAgFw0yNjEwMjMwMzM3NTZaGA8yMTI2MDkyOTAz
Mzc1NlowFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZI
zj0DAQcDQgAEPpN7tuTSXc12UmsADceSHeO8ypmtCHBetaAP1ykN4Dy2BJXhiOrv
pyGBbPYFVA+kpIAetNhwgITZ7UCOx0wU/KMpMCcwDAYDVR0TAQH/BAIwADAXBgNV
HREEEDAOggxleGFtcGxlLnRlc3QwCgYIKoZIzj0EAwIDSAAwRQIhAM/8xvHxr9Fh
jofwdP9erbSG/k1aRHSoBJUmW9q7vgfzAiB6tStpevnGx+wbRRtzOWw1Qq79mGvb
+fgnPht+8BtHpA==
-----END CERTIFICATE-----`);

/** Answers each address with the certificate given for it, and with none otherwise. */
const fakeDownload =
  (certificates: Record<string, X509Certificate>) => async (url: string) =>
    certificates[url] ?? null;

test("keeps the intermediate a root issued, passing over an impostor of its name before it", async () => {
  const issuer = await downloadIssuer(
    LEAF,
    [
      "http://example.test/impostor.crt",
      "http://example.test/intermediate.crt",
    ],
    [ROOT],
    fakeDownload({
      "http://example.test/impostor.crt": IMPOSTOR,
      "http://example.test/intermediate.crt": INTERMEDIATE,
    })
  );

  expect(issuer.fingerprint256).toBe(INTERMEDIATE.fingerprint256);
});

test("passes over an issuer no trusted root issued", async () => {
  await expect(
    downloadIssuer(
      LEAF,
      ["http://example.test/intermediate.crt"],
      [],
      fakeDownload({ "http://example.test/intermediate.crt": INTERMEDIATE })
    )
  ).rejects.toThrow("a trusted root issued");

  // A man in the middle's own CA verifies the certificate it forged, but no root issued it.
  await expect(
    downloadIssuer(
      ROGUE_LEAF,
      ["http://example.test/rogue.crt"],
      [ROOT],
      fakeDownload({ "http://example.test/rogue.crt": ROGUE_CA })
    )
  ).rejects.toThrow("a trusted root issued");
});

test("passes over a certificate of the issuer's name and key that may not issue others", async () => {
  await expect(
    downloadIssuer(
      LEAF,
      ["http://example.test/not-a-ca.crt"],
      [ROOT],
      fakeDownload({ "http://example.test/not-a-ca.crt": NOT_A_CA })
    )
  ).rejects.toThrow("a trusted root issued");
});

test("fails when no address it names holds the issuer", async () => {
  await expect(
    downloadIssuer(
      LEAF,
      ["http://example.test/missing.crt"],
      [ROOT],
      fakeDownload({})
    )
  ).rejects.toThrow("a trusted root issued");
});

test("downloads only from http addresses", async () => {
  await expect(
    downloadCertificate("https://example.test/intermediate.crt")
  ).rejects.toThrow("not an http address");
});

test("never asks a server on this computer, by name or by number", async () => {
  let asked = 0;

  const server = createServer((_request, response) => {
    asked += 1;
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  // SAFETY: a server listening on a TCP port has an AddressInfo address.
  const { port } = server.address() as AddressInfo;

  try {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "[::1]",
      "[::ffff:127.0.0.1]",
    ]) {
      await expect(
        downloadCertificate(`http://${host}:${port}/intermediate.crt`)
      ).rejects.toThrow("on this computer or its network");
    }

    expect(asked).toBe(0);
  } finally {
    server.close();
  }
});
