// Renderer dev server + watched main/preload builds. Electron itself is (re)started by the
// pack `onSuccess` hook in vite.config.ts once both bundles exist.
import { spawn } from "node:child_process";

import { retry } from "es-toolkit";

// vite.config.ts serves the renderer on this URL's port.
const RENDERER_URL = "http://localhost:5173";

const env = { ...process.env, SOLYX_RENDERER_URL: RENDERER_URL };

const children = [];

let shuttingDown = false;

function start(args) {
  const child = spawn("vp", args, { stdio: "inherit", env });
  child.on("exit", (code) => shutdown(code ?? 0));
  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) child.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));

process.on("SIGTERM", () => shutdown(0));

start(["dev"]);

// The dev server answers within seconds; give up after ~30s instead of hanging.
try {
  await retry(() => fetch(RENDERER_URL), { retries: 150, delay: 200 });
} catch {
  console.error(`[dev] renderer never answered at ${RENDERER_URL}`);
  shutdown(1);
}

start(["pack", "--watch"]);
