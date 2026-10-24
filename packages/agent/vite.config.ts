import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Backtests run on the kernel, which the tests load from its own build.
      test: { command: "vp test", dependsOn: ["@solyx/kernel#build"] },
    },
  },
});
