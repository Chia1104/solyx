import { createRequire } from "node:module";

import type * as native from "./index.d.ts";

/** The kernel built beside this module: the package's own build here, and a copy beside the app's bundle. */
export const kernel: typeof native = createRequire(import.meta.url)(
  "./solyx-kernel.node"
);
