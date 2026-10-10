import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Secret } from "#shared/ipc/settings.ts";

import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";
import { parseOtlpHeaders } from "../src/main/modules/telemetry/otlp-headers.ts";
import { createTelemetry } from "../src/main/modules/telemetry/telemetry.ts";
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

  const report = vi.fn();

  const telemetry = createTelemetry({
    config,
    secrets,
    version: "1.2.3",
    channel: AppChannel.Nightly,
    report,
  });

  return { config, secrets, telemetry, report };
}

/** Lets the telemetry module follow a change, which it applies one at a time. */
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
  const { telemetry } = setup();

  await settle();
  telemetry.tracer.startSpan("unsent").end();
  telemetry.diagnostics.recovered(new Error("offline"), "news.embed");
  await telemetry.close();

  expect(received).toEqual([]);
});

test("traces and logs go to the endpoint with the saved headers, and stop when it is unset", async () => {
  const { config, secrets, telemetry } = setup();

  await secrets.save(Secret.OtlpHeaders, "Authorization=Basic%20abc");
  config.set(["otlp", "endpoint"], endpoint);
  await settle();

  const pass = telemetry.tracer.startSpan("News collection");

  await telemetry.within(pass, async () =>
    telemetry.diagnostics.recovered(
      Object.assign(new Error("429 for sk-live-1234"), { status: 429 }),
      "news.collect",
      { "solyx.listing": "TW:2330" }
    )
  );
  pass.end();

  config.set(["otlp", "endpoint"], undefined);
  await settle();

  telemetry.tracer.startSpan("after").end();
  await telemetry.close();

  const traces = received.find(({ url }) => url === "/otlp/v1/traces");
  const logs = received.find(({ url }) => url === "/otlp/v1/logs");

  expect(received).toHaveLength(2);
  expect(traces?.headers.authorization).toBe("Basic abc");
  expect(traces?.body).toContain('"News collection"');
  expect(traces?.body).toContain('"nightly"');
  expect(traces?.body).not.toContain('"after"');

  expect(logs?.headers.authorization).toBe("Basic abc");
  expect(logs?.body).toContain('"news.collect failed"');
  expect(logs?.body).toContain('"TW:2330"');
  expect(logs?.body).toContain(pass.spanContext().traceId);
  expect(logs?.body).toContain('"http.response.status_code"');
  // What a provider answered may echo a key, so the log keeps only its kind.
  expect(logs?.body).not.toContain("sk-live-1234");
});

test("only a failure nothing should cause is reported, tagged with what failed", () => {
  const { telemetry, report } = setup();
  const offline = new Error("offline");
  const broken = new TypeError("cannot read properties of undefined");

  telemetry.diagnostics.recovered(offline, "news.embed");
  telemetry.diagnostics.report(broken, "scheduler.pass", {
    "solyx.work": "News collection",
  });

  expect(report).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(broken, {
    event: "scheduler.pass",
    "solyx.work": "News collection",
  });
});
