import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type { Span } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { Secret } from "#shared/ipc/settings.ts";

import type { AppChannel } from "../../shell/app-channel.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

import { createDiagnostics } from "./diagnostics.ts";
import type { ReportError } from "./diagnostics.ts";
import { parseOtlpHeaders } from "./otlp-headers.ts";

// Incubating conventions, copied rather than imported as their package advises.
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";

const ATTR_SERVICE_INSTANCE_ID = "service.instance.id";

const EXPORT_TIMEOUT_MS = 10_000;

/** Hands what the app records to the exporters of the endpoint in force. */
interface Exporting {
  spans: SpanProcessor;
  logs: LogRecordProcessor;
}

export interface TelemetryOptions {
  config: ConfigFile;
  secrets: SecretStore;
  version: string;
  channel: AppChannel;
  /** Where a failure nothing should cause is reported once the user agrees to crash reports. */
  report: ReportError;
}

/**
 * The app's traces and logs, sent over OTLP/HTTP to the endpoint the user set, with the headers
 * they saved, and dropped while none is set. It follows both as they change. Neither provider is
 * registered globally, so only what is handed the tracer or `diagnostics` is recorded, never a
 * library's own instrumentation.
 */
export function createTelemetry({
  config,
  secrets,
  version,
  channel,
  report,
}: TelemetryOptions) {
  let exporting: Exporting | undefined;
  // The endpoint and headers in force, so a change elsewhere in the settings rebuilds nothing.
  let applied: string | undefined;
  let following = Promise.resolve();

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "solyx",
    [ATTR_SERVICE_VERSION]: version,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: channel,
    [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
  });

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [
      {
        onStart: (span, context) => exporting?.spans.onStart(span, context),
        onEnd: (span) => exporting?.spans.onEnd(span),
        forceFlush: async () => exporting?.spans.forceFlush(),
        shutdown: async () => exporting?.spans.shutdown(),
      },
    ],
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      {
        onEmit: (record, context) => exporting?.logs.onEmit(record, context),
        forceFlush: async () => exporting?.logs.forceFlush(),
        shutdown: async () => exporting?.logs.shutdown(),
      },
    ],
  });

  const active = new AsyncLocalStorage<Span>();

  const diagnostics = createDiagnostics({
    logger: loggerProvider.getLogger("solyx", version),
    activeSpan: () => active.getStore(),
    report,
  });

  async function apply() {
    const { endpoint } = config.read().otlp;

    const headers =
      endpoint === undefined
        ? undefined
        : await secrets.get(Secret.OtlpHeaders);

    const key = JSON.stringify([endpoint, headers]);

    if (key === applied) return;

    applied = key;

    const previous = exporting;

    if (endpoint === undefined) {
      exporting = undefined;
    } else {
      const base = endpoint.replace(/\/+$/, "");

      const options = {
        headers: headers === undefined ? {} : parseOtlpHeaders(headers),
        timeoutMillis: EXPORT_TIMEOUT_MS,
      };

      exporting = {
        spans: new BatchSpanProcessor(
          new OTLPTraceExporter({ ...options, url: `${base}/v1/traces` })
        ),
        logs: new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ ...options, url: `${base}/v1/logs` }),
        }),
      };
    }

    // What they still hold goes to the endpoint they were given.
    await Promise.all([previous?.spans.shutdown(), previous?.logs.shutdown()]);
  }

  // One at a time, so a settings change and a secret change cannot cross.
  const follow = () => {
    following = following
      .then(apply)
      .catch((error) => diagnostics.report(error, "telemetry.apply"));
  };

  const stopFollowingConfig = config.onChange(follow);

  const stopFollowingSecrets = secrets.onChange((secret) => {
    if (secret === Secret.OtlpHeaders) follow();
  });

  follow();

  return {
    tracer: tracerProvider.getTracer("solyx", version),

    diagnostics,

    /** Runs `work` as part of `span`, so what it logs joins that span's trace. */
    within: <T>(span: Span, work: () => Promise<T>) => active.run(span, work),

    /** Sends what is still held, as the app quits. */
    async close() {
      stopFollowingConfig();
      stopFollowingSecrets();
      await following;
      await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown()]);
    },
  };
}

export type Telemetry = ReturnType<typeof createTelemetry>;
