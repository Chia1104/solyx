// Holds no part of the text, since the text is a secret.
const MALFORMED =
  "Write the headers as key=value pairs separated by commas, as OTEL_EXPORTER_OTLP_HEADERS takes them";

/**
 * Reads headers as `OTEL_EXPORTER_OTLP_HEADERS` gives them: comma-separated `key=value` pairs whose
 * values are percent-encoded, such as `Authorization=Basic%20…` from Grafana Cloud. The variable's
 * own `export OTEL_EXPORTER_OTLP_HEADERS="…"` line, as it is shown to be copied, reads the same.
 */
export function parseOtlpHeaders(text: string) {
  const pairs = text
    .trim()
    .replace(/^(?:export\s+)?OTEL_EXPORTER_OTLP_HEADERS=/, "")
    .replace(/^(["'])(.*)\1$/s, "$2")
    .split(",")
    .filter((pair) => pair.trim() !== "");

  if (pairs.length === 0) throw new Error(MALFORMED);

  return Object.fromEntries(
    pairs.map((pair) => {
      const at = pair.indexOf("=");
      const key = pair.slice(0, at).trim();

      if (at < 0 || key === "") throw new Error(MALFORMED);

      return [key, decode(pair.slice(at + 1).trim())];
    })
  );
}

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(MALFORMED);
  }
}
