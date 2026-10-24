import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Writes the native build and its types beside src/kernel.ts, which loads them. Cargo keeps
      // its own incremental build and the build differs by platform, so no run is replayed.
      build: {
        command: "napi build --release --output-dir src --no-dts-header",
        cache: false,
      },
    },
  },
});
