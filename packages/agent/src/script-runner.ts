import type { JsonValue } from "@earendil-works/chord";
import { CodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode";
import type {
  CodemodeResult,
  CodemodeStoreWrites,
  CodemodeTool,
} from "@earendil-works/pi-codemode";
import { omit } from "es-toolkit";
import * as z from "zod";

/**
 * Where a bundled host ships QuickJS and the worker's entry, since neither is on disk beside a
 * bundle; left out, the installed packages' own files are used.
 */
export interface ScriptFiles {
  wasm: string;
  worker: URL;
}

/** What one script can reach and how long it may run. */
export interface ScriptScope {
  /** Functions a script calls as `tools.<name>`. */
  tools?: CodemodeTool[];
  /** Functions a script calls by name, such as `indicators.sma`. */
  globals?: CodemodeTool[];
  /** @default no deadline */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** What the script reads with `load`; what it stores comes back with its result. */
  store?: Readonly<Record<string, JsonValue>>;
}

/** How a script ended, with what it printed and returned, or how it failed, as the model reads it. */
export type ScriptResult =
  | { ok: true; output: string; storeWrites: CodemodeStoreWrites }
  | { ok: false; output: string };

const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

// What a script printed and returned reaches the model whole up to here.
const MAX_OUTPUT_CHARS = 20_000;

/** A function scripts call, whose arguments are parsed since a script may pass anything. */
export function scriptFunction<
  Input extends z.ZodType,
  Output extends z.ZodType,
>(
  spec: Pick<CodemodeTool, "name" | "description" | "spread" | "signature"> & {
    input: Input;
    output: Output;
    run(input: z.infer<Input>): Promise<z.input<Output>> | z.input<Output>;
  }
): CodemodeTool {
  return {
    ...omit(spec, ["input", "output", "run"]),
    inputSchema: z.toJSONSchema(spec.input, { io: "input" }),
    outputSchema: z.toJSONSchema(spec.output),
    async execute(args) {
      const parsed = spec.input.safeParse(args ?? {});

      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

      return spec.run(parsed.data);
    },
  };
}

function outputText(result: CodemodeResult, timeoutMs: number) {
  const lines = result.output.flatMap((item) =>
    item.type === "text" ? [item.text] : []
  );

  if (!result.ok) {
    lines.push(
      result.error.kind === "timeout"
        ? `The script ran past ${timeoutMs / 1000} seconds and was stopped`
        : (result.error.stack ?? result.error.message)
    );
  } else if (result.value !== undefined) {
    lines.push(`Result: ${JSON.stringify(result.value)}`);
  }

  const text =
    lines.join("\n") || "The script printed nothing and returned nothing.";

  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… cut at ${MAX_OUTPUT_CHARS} characters; aggregate in the script and print less`
    : text;
}

/**
 * Runs the agent's own JavaScript in a QuickJS VM (pi-codemode), each script on a worker thread
 * of its own with a memory limit, reaching only what its scope gives it. Nothing loads before the
 * first script runs.
 */
export function createScriptRunner(files?: ScriptFiles) {
  /** Sandboxes of scripts still running, which `close` stops. */
  const live = new Set<CodemodeSandbox>();

  return {
    /** Never rejects for the script's own failure, which its result tells. */
    async run(code: string, scope: ScriptScope): Promise<ScriptResult> {
      const timeoutMs = scope.timeoutMs ?? Number.POSITIVE_INFINITY;

      const sandbox = new CodemodeSandbox({
        tools: scope.tools,
        globals: scope.globals,
        timeoutMs,
        memoryLimitBytes: MEMORY_LIMIT_BYTES,
        ...(files && {
          wasm: loadQuickJSWasm(files.wasm),
          workerUrl: files.worker,
        }),
      });

      live.add(sandbox);

      let result: CodemodeResult;

      try {
        result = await sandbox.execute(code, {
          signal: scope.signal,
          store: scope.store,
        });
      } finally {
        live.delete(sandbox);
        await sandbox.close();
      }

      const output = outputText(result, timeoutMs);

      return result.ok
        ? { ok: true, output, storeWrites: result.storeWrites }
        : { ok: false, output };
    },

    /** Stops scripts still running, as the app quits. */
    async close() {
      await Promise.all([...live].map((sandbox) => sandbox.close()));
    },
  };
}

export type ScriptRunner = ReturnType<typeof createScriptRunner>;
