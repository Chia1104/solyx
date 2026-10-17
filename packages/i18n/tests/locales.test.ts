import { flattenObject } from "es-toolkit";
import { expect, test } from "vite-plus/test";

import desktopEnUS from "../desktop/en-US.json" with { type: "json" };
import desktopZhTW from "../desktop/zh-TW.json" with { type: "json" };
import websiteEnUS from "../website/en-US.json" with { type: "json" };
import websiteZhTW from "../website/zh-TW.json" with { type: "json" };

function variables(message: string): string[] {
  return [...message.matchAll(/\{\{\s*([\w-]+)/g)]
    .map((match) => match[1])
    .toSorted();
}

const catalogs = [
  {
    locale: "desktop zh-TW",
    source: flattenObject(desktopEnUS),
    target: flattenObject(desktopZhTW),
  },
  {
    locale: "website zh-TW",
    source: flattenObject(websiteEnUS),
    target: flattenObject(websiteZhTW),
  },
];

test.each(catalogs)(
  "$locale has the same keys as en-US",
  ({ source, target }) => {
    expect(Object.keys(target).toSorted()).toEqual(
      Object.keys(source).toSorted()
    );
  }
);

test.each(catalogs)(
  "$locale interpolates the same variables as en-US",
  ({ source, target }) => {
    for (const [key, message] of Object.entries(source)) {
      expect(variables(target[key] ?? ""), key).toEqual(variables(message));
    }
  }
);
