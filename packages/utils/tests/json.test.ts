import { expect, test } from "vite-plus/test";
import * as z from "zod";

import { parseJson } from "../src/json.ts";

const countSchema = z.object({ count: z.number() });

test("JSON reads through its schema", () => {
  expect(parseJson('{"count": 2}', countSchema)).toEqual({ count: 2 });
});

test("text that is not JSON, or JSON the schema refuses, reads as nothing", () => {
  expect(parseJson("{count: 2}", countSchema)).toBeUndefined();
  expect(parseJson('{"count": "2"}', countSchema)).toBeUndefined();
});
