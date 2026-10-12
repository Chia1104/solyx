import { session } from "electron";

/**
 * `fetch` over Chromium's network stack instead of Node's. A server that leaves an intermediate
 * certificate out of its chain still verifies there, since Chromium fetches the missing one from
 * where the certificate says its issuer's is published, as a browser does and Node does not. It
 * runs in a session of its own kept in memory, so no source's cookie or cached answer is written
 * to disk or shared with a window.
 */
export const chromiumFetch: typeof fetch = (input, init) =>
  session
    .fromPartition("sources")
    .fetch(input instanceof URL ? input.href : input, init);
