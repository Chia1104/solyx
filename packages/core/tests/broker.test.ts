import { expect, test } from "vite-plus/test";

import { orderTag } from "../src/broker.ts";

test("an order's tag is six letters and digits, the same for the same proposal", () => {
  const tag = orderTag("4d0c1f5e-7a52-4c55-9d61-2f6a3e0b9c11");

  expect(tag).toMatch(/^[0-9A-Z]{6}$/);
  expect(orderTag("4d0c1f5e-7a52-4c55-9d61-2f6a3e0b9c11")).toBe(tag);
});

test("proposals made one after another take different tags", () => {
  const tags = new Set(
    Array.from({ length: 1000 }, (_, index) => orderTag(`proposal-${index}`))
  );

  expect(tags.size).toBe(1000);
});
