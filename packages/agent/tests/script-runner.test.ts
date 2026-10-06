import { expect, test } from "vite-plus/test";

import { createScriptRunner } from "../src/script-runner.ts";

test("a script past its deadline is stopped, and the model is told why", async () => {
  const runner = createScriptRunner();

  expect(await runner.run("while (true) {}", { timeoutMs: 100 })).toEqual({
    ok: false,
    output: "The script ran past 0.1 seconds and was stopped",
  });
});

test("closing the runner stops a script that has no deadline", async () => {
  const runner = createScriptRunner();
  const running = runner.run("while (true) {}", {});

  await runner.close();

  expect(await running).toMatchObject({ ok: false });
});
