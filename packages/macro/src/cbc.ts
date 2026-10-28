import { maxBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import type {
  ExchangeRate,
  ExchangeRateProvider,
} from "@solyx/core/exchange-rate";

const CBC_URL = "https://cpx.cbc.gov.tw/api/OpenData/";

/** A business day's close of the interbank market, its day as `YYYYMMDD` and the rate as decimal text. */
const closeSchema = z.object({
  日期: z.string().regex(/^\d{8}$/),
  NTD_USD: z.string().transform(Number).pipe(z.number().positive()),
});

export interface CbcOptions {
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * The US dollar's rate in Taiwan dollars from the central bank's open data: each business day's
 * close of the interbank market in Taipei, which needs no key and comes out the same evening.
 */
export function createCbc(options: CbcOptions = {}): ExchangeRateProvider {
  const api = ky.create({
    baseUrl: CBC_URL,
    fetch: options.fetch,
    hooks: {
      beforeError: [
        ({ error }) => {
          error.message = isHTTPError(error)
            ? `The central bank answered ${error.response.status}`
            : `The central bank: ${error.message}`;

          return error;
        },
      ],
    },
  });

  return {
    id: "cbc",

    async latest(): Promise<ExchangeRate> {
      // Every close since 2008 at once, since the API takes no range.
      const rows = z
        .array(z.unknown())
        .safeParse(await api.get("FTDOpenData_Day").json());

      if (!rows.success) {
        throw new Error("The central bank's exchange rates did not read");
      }

      const newest = maxBy(
        rows.data.flatMap((row) => {
          const close = closeSchema.safeParse(row);

          return close.success ? [close.data] : [];
        }),
        (close) => Number(close.日期)
      );

      if (!newest) {
        throw new Error("The central bank listed no exchange rate");
      }

      const day = newest.日期;

      return {
        date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`,
        twdPerUsd: newest.NTD_USD,
      };
    },
  };
}
