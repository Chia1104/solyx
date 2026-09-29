// Renderer dev server + watched main/preload builds. Electron itself is (re)started by the
// pack `onSuccess` hook in vite.config.ts once both bundles exist.
import { spawn } from "node:child_process";

// Must match `server.port` in vite.config.ts.
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

async function waitForRenderer() {
  for (;;) {
    try {
      await fetch(RENDERER_URL);

      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

process.on("SIGINT", () => shutdown(0));

process.on("SIGTERM", () => shutdown(0));

start(["dev"]);

await waitForRenderer();

start(["pack", "--watch"]);
