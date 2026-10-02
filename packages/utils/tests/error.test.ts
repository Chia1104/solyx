import { describe, expect, test } from "vite-plus/test";

import { errorMessage, isErrnoError } from "../src/error.ts";

describe("errorMessage", () => {
  test("reads an error's message and stringifies anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("boom")).toBe("boom");
  });
});

describe("isErrnoError", () => {
  test("matches a system error by its code", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(isErrnoError(error, "ENOENT")).toBe(true);
    expect(isErrnoError(error, "EEXIST")).toBe(false);
    expect(isErrnoError({ code: "ENOENT" }, "ENOENT")).toBe(false);
  });
});
