import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { Secret } from "#shared/ipc/settings.ts";

import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";
import { parseOtlpHeaders } from "../src/main/modules/traces/otlp-headers.ts";
import { createTraces } from "../src/main/modules/traces/traces.ts";
import { AppChannel } from "../src/main/shell/app-channel.ts";

import { fakeCipher } from "./fake-cipher.ts";

interface Received {
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

let home: string;

let server: Server;

let received: Received[];

let endpoint: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solyx-traces-"));
  received = [];
  server = createServer((request, response) => {
    let body = "";

    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      received.push({ url: request.url, headers: request.headers, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: a server listening on a TCP port reports an AddressInfo.
  const { port } = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${port}/otlp`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(home, { recursive: true, force: true });
});

function setup() {
  const config = createConfigFile(join(home, ".solyx", "config.json"));

  config.create();

  const secrets = createSecretStore(
    join(home, "data", "secrets.json"),
    fakeCipher().cipher
  );

  const traces = createTraces({
    config,
    secrets,
    version: "1.2.3",
    channel: AppChannel.Nightly,
  });

  return { config, secrets, traces };
}

/** Lets the traces module follow a change, which it applies one at a time. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("headers read as OTEL_EXPORTER_OTLP_HEADERS writes them, the line Grafana Cloud shows included", () => {
  expect(parseOtlpHeaders("Authorization=Basic%20abc%3D, X-Scope=1")).toEqual({
    Authorization: "Basic abc=",
    "X-Scope": "1",
  });
  expect(
    parseOtlpHeaders(
      'export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20abc"'
    )
  ).toEqual({ Authorization: "Basic abc" });

  // One fixed message, so a secret mistyped never reaches the screen or a log.
  for (const malformed of ["glc_secret", "=glc_secret", ",", "Key=glc%E0%A4%A"])
    expect(() => parseOtlpHeaders(malformed)).toThrow(
      /^Write the headers as key=value pairs/
    );
});

test("nothing is sent until an endpoint is set", async () => {
  const { traces } = setup();

  await settle();
  traces.tracer.startSpan("unsent").end();
  await traces.close();

  expect(received).toEqual([]);
});

test("spans go to the endpoint's /v1/traces with the saved headers, and stop when it is unset", async () => {
  const { config, secrets, traces } = setup();

  await secrets.save(Secret.TraceHeaders, "Authorization=Basic%20abc");
  config.set(["traces", "endpoint"], endpoint);
  await settle();

  traces.tracer.startSpan("News collection").end();

  config.set(["traces", "endpoint"], undefined);
  await settle();

  traces.tracer.startSpan("after").end();
  await traces.close();

  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({
    url: "/otlp/v1/traces",
    headers: { authorization: "Basic abc" },
  });
  expect(received[0]?.body).toContain('"News collection"');
  expect(received[0]?.body).toContain('"nightly"');
  expect(received[0]?.body).not.toContain('"after"');
});
