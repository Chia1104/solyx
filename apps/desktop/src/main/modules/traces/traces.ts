import { randomUUID } from "node:crypto";

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { errorMessage } from "@solyx/utils/error";

import { Secret } from "#shared/ipc/settings.ts";

import type { AppChannel } from "../../shell/app-channel.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

import { parseOtlpHeaders } from "./otlp-headers.ts";

// Incubating conventions, copied rather than imported as their package advises.
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";

const ATTR_SERVICE_INSTANCE_ID = "service.instance.id";

const EXPORT_TIMEOUT_MS = 10_000;

export interface TracesOptions {
  config: ConfigFile;
  secrets: SecretStore;
  version: string;
  channel: AppChannel;
}

/**
 * The app's traces, sent over OTLP/HTTP to the endpoint the user set, with the headers they saved,
 * and dropped while none is set. It follows both as they change. The provider is never registered
 * globally, so only what is handed its tracer is traced, never a library's own instrumentation.
 */
export function createTraces({
  config,
  secrets,
  version,
  channel,
}: TracesOptions) {
  let exporting: SpanProcessor | undefined;
  // The endpoint and headers in force, so a change elsewhere in the settings rebuilds nothing.
  let applied: string | undefined;
  let following = Promise.resolve();

  const processor: SpanProcessor = {
    onStart: (span, context) => exporting?.onStart(span, context),
    onEnd: (span) => exporting?.onEnd(span),
    forceFlush: async () => exporting?.forceFlush(),
    shutdown: async () => exporting?.shutdown(),
  };

  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "solyx",
      [ATTR_SERVICE_VERSION]: version,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: channel,
      [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
    }),
    spanProcessors: [processor],
  });

  async function apply() {
    const { endpoint } = config.read().traces;

    const headers =
      endpoint === undefined
        ? undefined
        : await secrets.get(Secret.TraceHeaders);

    const key = JSON.stringify([endpoint, headers]);

    if (key === applied) return;

    applied = key;

    const previous = exporting;

    exporting =
      endpoint === undefined
        ? undefined
        : new BatchSpanProcessor(
            new OTLPTraceExporter({
              url: `${endpoint.replace(/\/+$/, "")}/v1/traces`,
              headers: headers === undefined ? {} : parseOtlpHeaders(headers),
              timeoutMillis: EXPORT_TIMEOUT_MS,
            })
          );

    // What it still holds goes to the endpoint it was given.
    await previous?.shutdown();
  }

  // One at a time, so a settings change and a secret change cannot cross.
  const follow = () => {
    following = following
      .then(apply)
      .catch((error) =>
        console.error(`Starting traces failed: ${errorMessage(error)}`)
      );
  };

  const stopFollowingConfig = config.onChange(follow);

  const stopFollowingSecrets = secrets.onChange((secret) => {
    if (secret === Secret.TraceHeaders) follow();
  });

  follow();

  return {
    tracer: provider.getTracer("solyx", version),

    /** Sends what is still held, as the app quits. */
    async close() {
      stopFollowingConfig();
      stopFollowingSecrets();
      await following;
      await provider.shutdown();
    },
  };
}

export type Traces = ReturnType<typeof createTraces>;
