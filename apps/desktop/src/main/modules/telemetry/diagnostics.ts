import { ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { LogAttributes, Logger } from "@opentelemetry/api-logs";
import * as z from "zod";

import { errorMessage } from "@solyx/utils/error";

/** Identifiers that say what a failure was about, such as a listing or a scheduled work's name. */
export type FailureAttributes = Readonly<Record<string, string>>;

/** Where a failure of the app's own goes once the user agrees to crash reports. */
export type ReportError = (
  cause: unknown,
  tags: Readonly<Record<string, string>>
) => void;

/** Every failure the main process does not rethrow goes through these, never through `console`. */
export interface Diagnostics {
  /** A failure the app recovers from, such as a provider that did not answer: logged, never reported. */
  recovered(
    cause: unknown,
    event: string,
    attributes?: FailureAttributes
  ): void;
  /** A failure nothing should cause: logged, and reported once the user agrees to crash reports. */
  report(cause: unknown, event: string, attributes?: FailureAttributes): void;
}

// What kind of failure it was; its message stays out, since a provider's may echo part of a key.
const failureSchema = z.object({
  code: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  status: z.number().optional().catch(undefined),
  response: z.object({ status: z.number() }).optional().catch(undefined),
});

function failureAttributes(cause: unknown): LogAttributes {
  const failure = failureSchema.safeParse(cause);

  if (!failure.success) return { "exception.type": "unknown" };

  const { code, name, status, response } = failure.data;

  const attributes: LogAttributes = {
    "exception.type": code ?? name ?? "unknown",
  };

  const httpStatus = status ?? response?.status;

  if (httpStatus !== undefined)
    attributes["http.response.status_code"] = httpStatus;

  return attributes;
}

export interface DiagnosticsOptions {
  logger: Logger;
  /** The span what runs now belongs to, so its logs join that trace. */
  activeSpan: () => Span | undefined;
  report: ReportError;
}

/**
 * Writes each failure to the terminal in full, and to the OpenTelemetry logs as what failed, the
 * identifiers given and the failure's type and HTTP status.
 */
export function createDiagnostics({
  logger,
  activeSpan,
  report,
}: DiagnosticsOptions): Diagnostics {
  function log(
    severity: SeverityNumber,
    cause: unknown,
    event: string,
    attributes: FailureAttributes
  ) {
    const span = activeSpan();

    logger.emit({
      eventName: event,
      severityNumber: severity,
      severityText: SeverityNumber[severity],
      body: `${event} failed`,
      attributes: { ...attributes, ...failureAttributes(cause) },
      context: span ? trace.setSpan(ROOT_CONTEXT, span) : undefined,
    });
  }

  const describe = (event: string, attributes: FailureAttributes) =>
    [event, ...Object.values(attributes)].join(" ");

  return {
    recovered(cause, event, attributes = {}) {
      console.warn(
        `${describe(event, attributes)} failed:`,
        errorMessage(cause)
      );
      log(SeverityNumber.WARN, cause, event, attributes);
    },

    report(cause, event, attributes = {}) {
      console.error(`${describe(event, attributes)} failed:`, cause);
      log(SeverityNumber.ERROR, cause, event, attributes);
      report(cause, { event, ...attributes });
    },
  };
}
