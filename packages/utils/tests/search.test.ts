import { expect, test } from "vite-plus/test";

import { createSearchIndex, searchTerms } from "../src/search.ts";

const search = (texts: string[], query: string) =>
  createSearchIndex(texts, (text) => [text])(query);

test("a document holding the query's rarer word ranks first, and one holding none is left out", () => {
  expect(
    search(
      [
        "List orders in the account",
        "Latest price of a listing",
        "Weather forecast",
        "Price history of orders",
      ],
      "order price"
    )
  ).toEqual([
    "Price history of orders",
    "List orders in the account",
    "Latest price of a listing",
  ]);
});

test("words match across camelCase, plurals and case", () => {
  const texts = ["getQuotes", "listIssues", "Search"];

  expect(search(texts, "QUOTE")).toEqual(["getQuotes"]);
  expect(search(texts, "issue")).toEqual(["listIssues"]);
  expect(search(texts, "searches")).toEqual(["Search"]);
});

test("a word whose case changes within matches whole before its parts, and a lone letter matches nothing", () => {
  expect(searchTerms("TSMC's CoWoS")).toEqual(["tsmc", "cowo", "co", "wo"]);
  expect(
    search(["Co-founder's view", "CoWoS capacity", "Plan B"], "CoWoS")
  ).toEqual(["CoWoS capacity", "Co-founder's view"]);
});

test("Chinese matches by pairs of characters, since it is written without spaces", () => {
  expect(search(["取得台股即時報價", "查詢帳戶餘額"], "報價")).toEqual([
    "取得台股即時報價",
  ]);
  expect(search(["取得台股即時報價", "查詢帳戶餘額"], "帳戶 quote")).toEqual([
    "查詢帳戶餘額",
  ]);
});

test("terms are lowercase words and pairs of Chinese characters, without stop words", () => {
  expect(searchTerms("The TSMC margin: 台積電毛利")).toEqual([
    "tsmc",
    "margin",
    "台積",
    "積電",
    "電毛",
    "毛利",
  ]);
});

test("a query of stop words alone finds nothing, and ties keep their order", () => {
  expect(search(["the price", "of the price"], "the of")).toEqual([]);
  expect(search(["price a", "price b"], "price")).toEqual([
    "price a",
    "price b",
  ]);
});
