import { X509Certificate } from "node:crypto";

import { expect, test } from "vite-plus/test";

import { downloadIssuer } from "../src/chain-fetch.ts";

// Synthetic certificates made for these tests, with no key kept: a server's, issued by an
// intermediate that a root issued.

/** The server's certificate, issued by `INTERMEDIATE`. */
const LEAF = `-----BEGIN CERTIFICATE-----
MIIBpjCCAUugAwIBAgIUMnMcy1UHfk/iIESCRBtrkad58D0wCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwURXhhbXBsZSBJbnRlcm1lZGlhdGUwIBcNMjYxMDIzMDMzMDQ4
WhgPMjEyNjA5MjkwMzMwNDhaMBcxFTATBgNVBAMMDGV4YW1wbGUudGVzdDBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABIY++ZuG6Y5T4uy+GZuKbmf5ysht2oc5PXNU
OFYExx6APksVHx3IZ1BifIv3QRESLPX+K5t8fo9JdJ0D888rVcSjazBpMAwGA1Ud
EwEB/wQCMAAwFwYDVR0RBBAwDoIMZXhhbXBsZS50ZXN0MEAGCCsGAQUFBwEBBDQw
MjAwBggrBgEFBQcwAoYkaHR0cDovL2V4YW1wbGUudGVzdC9pbnRlcm1lZGlhdGUu
Y3J0MAoGCCqGSM49BAMCA0kAMEYCIQCP5UjsfHE9iw5OdTc3tmiB7l5NB0S3OEz2
w/g32bBqegIhAPMcXS8x1erLNriEJ7kwbqXkkeQAO4sV3dpzI7o0ZQIA
-----END CERTIFICATE-----`;

/** The CA that issued `LEAF`. */
const INTERMEDIATE = `-----BEGIN CERTIFICATE-----
MIIBYTCCAQagAwIBAgIUIoWSTTexIR56qLdMAmhaxILwfBMwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMRXhhbXBsZSBSb290MCAXDTI2MTAyMzAzMzA0OFoYDzIxMjYw
OTI5MDMzMDQ4WjAfMR0wGwYDVQQDDBRFeGFtcGxlIEludGVybWVkaWF0ZTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABLGc3tX8YXEdxy2RBwlzgUKQ7fzRZnx0fUPx
51rFZlXF/OCz1NNn5UzBEppaCsNv/pQ4HgvkJouXQhZRXhJExcujJjAkMBIGA1Ud
EwEB/wQIMAYBAf8CAQAwDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0kAMEYC
IQDPLdBOFWE6Ie08jeSe26WO+wfIaibvdAopXeHIuS5dBgIhAI5u8WTnUi4mIhtV
PvLKQCR3WBDl4FhgE4j1x0oC/RD+
-----END CERTIFICATE-----`;

/** `INTERMEDIATE`'s name and key on a certificate that may not issue others. */
const NOT_A_CA = `-----BEGIN CERTIFICATE-----
MIIBWjCCAQCgAwIBAgIUIoWSTTexIR56qLdMAmhaxILwfBQwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMRXhhbXBsZSBSb290MCAXDTI2MTAyMzAzMzA0OFoYDzIxMjYw
OTI5MDMzMDQ4WjAfMR0wGwYDVQQDDBRFeGFtcGxlIEludGVybWVkaWF0ZTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABLGc3tX8YXEdxy2RBwlzgUKQ7fzRZnx0fUPx
51rFZlXF/OCz1NNn5UzBEppaCsNv/pQ4HgvkJouXQhZRXhJExcujIDAeMAwGA1Ud
EwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMAoGCCqGSM49BAMCA0gAMEUCIQCYClEm
WI98lBO2Bpg0WY1iwMP56JxVNVvQpmq1bfkTJwIgELQ2wH3XwRnN4dGeu/nOybdB
UMgiXj1wk4aJu9/u6tg=
-----END CERTIFICATE-----`;

/** A CA of `INTERMEDIATE`'s name with a key of its own. */
const IMPOSTOR = `-----BEGIN CERTIFICATE-----
MIIBhTCCASqgAwIBAgIUfkY+1jel0A28sbC29wRlT099se4wCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwURXhhbXBsZSBJbnRlcm1lZGlhdGUwIBcNMjYxMDIzMDMzMDQ4
WhgPMjEyNjA5MjkwMzMwNDhaMB8xHTAbBgNVBAMMFEV4YW1wbGUgSW50ZXJtZWRp
YXRlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnaDbSc513zrFbGlUByjuGXfY
t1A7P8S5iurCM8BEHvnR5MG7zk3Om+aJCbMZ8/pwxB4L0/j9NiOKOnCgR4KEmKNC
MEAwHQYDVR0OBBYEFLCJBStPBG/xxIBNqiQcuKYCadU2MA8GA1UdEwEB/wQFMAMB
Af8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0kAMEYCIQCZyVzcIF5frjco
RnentthOy1j3Ok265OF6JawmJDqJ4gIhAIlu1u34ecu8Rh/VbWTErAoPVgmperQk
Fru2ZzCkNd5C
-----END CERTIFICATE-----`;

const der = (pem: string) => new X509Certificate(pem).raw;

/** Answers each address with the certificate given for it, and 404 otherwise. */
const fakeFetch =
  (certificates: Record<string, string>) =>
  async (input: string | URL | Request) => {
    const pem = certificates[new Request(input).url];

    return pem
      ? new Response(new Uint8Array(der(pem)))
      : new Response(null, { status: 404 });
  };

test("keeps the CA that signed the certificate, passing over an impostor of its name before it", async () => {
  const issuer = await downloadIssuer(
    new X509Certificate(LEAF),
    [
      "http://example.test/impostor.crt",
      "http://example.test/intermediate.crt",
    ],
    fakeFetch({
      "http://example.test/impostor.crt": IMPOSTOR,
      "http://example.test/intermediate.crt": INTERMEDIATE,
    })
  );

  expect(issuer.fingerprint256).toBe(
    new X509Certificate(INTERMEDIATE).fingerprint256
  );
});

test("passes over a certificate of the issuer's name and key that may not issue others", async () => {
  await expect(
    downloadIssuer(
      new X509Certificate(LEAF),
      ["http://example.test/not-a-ca.crt"],
      fakeFetch({ "http://example.test/not-a-ca.crt": NOT_A_CA })
    )
  ).rejects.toThrow("held its issuer");
});

test("fails when no address it names holds the issuer", async () => {
  await expect(
    downloadIssuer(
      new X509Certificate(LEAF),
      ["http://example.test/missing.crt", "http://example.test/impostor.crt"],
      fakeFetch({ "http://example.test/impostor.crt": IMPOSTOR })
    )
  ).rejects.toThrow("held its issuer");
});
