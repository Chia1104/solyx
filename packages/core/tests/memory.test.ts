import { expect, test } from "vite-plus/test";

import {
  holdsSecret,
  memoryBodySchema,
  memoryChangeSchema,
} from "../src/memory.ts";

test("keys, tokens and ID numbers are secrets, while prose, codes and prices are not", () => {
  expect(holdsSecret("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe(true);
  expect(holdsSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
  expect(holdsSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  expect(holdsSecret("身分證 A123456789")).toBe(true);

  expect(holdsSecret("Stop below 950 on 2330; risk 0.5% per trade")).toBe(
    false
  );
  expect(holdsSecret("Prefers task-based replies, sk-style answers")).toBe(
    false
  );
});

test("a change keeps a one-line description and refuses a secret", () => {
  expect(
    memoryChangeSchema.parse({
      description: "  Risk 0.5% per trade ",
      body: "",
    })
  ).toEqual({ description: "Risk 0.5% per trade", body: "" });

  expect(
    memoryChangeSchema.safeParse({ description: "", body: "" }).success
  ).toBe(false);
  expect(
    memoryBodySchema.safeParse(
      "token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4"
    ).success
  ).toBe(false);
});
