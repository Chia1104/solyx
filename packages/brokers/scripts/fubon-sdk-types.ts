/**
 * Type-checks `./fubon` against a `fubon-neo` download's own declarations, failing where the SDK
 * no longer has what the module loads and calls, or takes it in another shape. It signs in to
 * nothing, so the Fubon SDK workflow runs it whenever the module changes, as well as on each
 * version Fubon offers.
 *
 *   vp exec node packages/brokers/scripts/fubon-sdk-types.ts <sdk folder>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [sdkDir] = process.argv.slice(2);

if (!sdkDir) throw new Error("Usage: fubon-sdk-types.ts <sdk folder>");

const sdk = [sdkDir, join(sdkDir, "package")].find((dir) =>
  existsSync(join(dir, "trade.d.ts"))
);

if (!sdk) throw new Error(`No Fubon Neo SDK declarations in ${sdkDir}`);

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const dir = mkdtempSync(join(tmpdir(), "solyx-fubon-types-"));

// The SDK's module has to fit where the module expects its binding. The module passes the SDK's
// string enums as their values, so those read as strings.
writeFileSync(
  join(dir, "check.mts"),
  `import type * as Sdk from ${JSON.stringify(join(sdk, "trade.js"))};
import type { FubonBinding } from ${JSON.stringify(local("../src/fubon.ts"))};

type Loose<T> = T extends string
  ? string
  : T extends abstract new (...args: infer A) => infer R
    ? new (...args: { [I in keyof A]: Loose<A[I]> }) => Loose<R>
    : T extends (...args: infer A) => infer R
      ? (...args: { [I in keyof A]: Loose<A[I]> }) => R
      : T extends object
        ? { [K in keyof T]: Loose<T[K]> }
        : T;

export const binding = (sdk: Loose<typeof Sdk>): FubonBinding => sdk;
`
);

writeFileSync(
  join(dir, "tsconfig.json"),
  JSON.stringify({
    extends: local("../tsconfig.json"),
    compilerOptions: { typeRoots: [local("../node_modules/@types")] },
    files: ["check.mts"],
  })
);

// The package exports no path to its compiler, so it is found beside the manifest it names.
const tsc = join(
  dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin",
  "tsc"
);

try {
  execFileSync(process.execPath, [tsc, "-p", dir], { stdio: "inherit" });
  console.log(`The module fits the declarations of the SDK in ${sdk}`);
} catch {
  console.log(
    `The module no longer fits the declarations of the SDK in ${sdk}`
  );
  process.exitCode = 1;
}
