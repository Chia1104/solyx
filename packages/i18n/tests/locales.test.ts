import { flattenObject } from "es-toolkit";
import { expect, test } from "vite-plus/test";

import enUS from "../desktop/en-US.json" with { type: "json" };
import zhTW from "../desktop/zh-TW.json" with { type: "json" };

function variables(message: string): string[] {
  return [...message.matchAll(/\{\{\s*([\w-]+)/g)]
    .map((match) => match[1])
    .toSorted();
}

const source = flattenObject(enUS);

const catalogs = [{ locale: "zh-TW", target: flattenObject(zhTW) }];

test.each(catalogs)("$locale has the same keys as en-US", ({ target }) => {
  expect(Object.keys(target).toSorted()).toEqual(
    Object.keys(source).toSorted()
  );
});

test.each(catalogs)(
  "$locale interpolates the same variables as en-US",
  ({ target }) => {
    for (const [key, message] of Object.entries(source)) {
      expect(variables(target[key] ?? ""), key).toEqual(variables(message));
    }
  }
);
