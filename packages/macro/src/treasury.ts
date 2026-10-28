import { range, sortBy, zipObject } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import { TreasuryTenor } from "@solyx/core/yields";
import type { YieldCurve, YieldCurveProvider } from "@solyx/core/yields";

const TREASURY_URL =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/";

/** The column the Treasury names each tenor's yield. */
const COLUMNS = {
  [TreasuryTenor.ThreeMonths]: "3 Mo",
  [TreasuryTenor.TwoYears]: "2 Yr",
  [TreasuryTenor.TenYears]: "10 Yr",
  [TreasuryTenor.ThirtyYears]: "30 Yr",
} as const satisfies Record<TreasuryTenor, string>;

/** A yield as the file writes it, empty on a day the Treasury did not price that tenor. */
const yieldSchema = z
  .string()
  .optional()
  .transform((text) =>
    text === undefined || text.trim() === "" ? null : Number(text)
  )
  .pipe(z.number().nonnegative().nullable());

/** A day's row, its date as `MM/DD/YYYY`. */
const rowSchema = z.object({
  Date: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/)
    .transform(
      (date) => `${date.slice(6)}-${date.slice(0, 2)}-${date.slice(3, 5)}`
    ),
  [COLUMNS[TreasuryTenor.ThreeMonths]]: yieldSchema,
  [COLUMNS[TreasuryTenor.TwoYears]]: yieldSchema,
  [COLUMNS[TreasuryTenor.TenYears]]: yieldSchema,
  [COLUMNS[TreasuryTenor.ThirtyYears]]: yieldSchema,
});

export interface TreasuryOptions {
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * US Treasury debt's daily par yield curve from the Treasury's own files, a year to a file, which
 * need no key and are the US government's work, free of copyright.
 */
export function createTreasury(
  options: TreasuryOptions = {}
): YieldCurveProvider {
  const now = options.now ?? (() => new Date());

  const api = ky.create({
    baseUrl: TREASURY_URL,
    fetch: options.fetch,
    hooks: {
      beforeError: [
        ({ error }) => {
          error.message = isHTTPError(error)
            ? `The Treasury answered ${error.response.status}`
            : `The Treasury: ${error.message}`;

          return error;
        },
      ],
    },
  });

  /** A year's curves by the names the file's first line gives its columns. */
  async function year(of: number): Promise<YieldCurve[]> {
    const text = await api
      .get(`daily-treasury-rates.csv/${of}/all`, {
        searchParams: {
          type: "daily_treasury_yield_curve",
          field_tdr_date_value: String(of),
          _format: "csv",
        },
      })
      .text();

    const [header = "", ...lines] = text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");

    const names = header.split(",").map((name) => name.replaceAll('"', ""));

    const missing = Object.values(COLUMNS).filter(
      (column) => !names.includes(column)
    );

    if (missing.length > 0) {
      throw new Error(
        `The Treasury's yield curve of ${of} no longer has ${missing.join(", ")}`
      );
    }

    return lines.flatMap((line): YieldCurve[] => {
      const row = rowSchema.safeParse(zipObject(names, line.split(",")));

      return row.success
        ? [
            {
              date: row.data.Date,
              yields: {
                [TreasuryTenor.ThreeMonths]:
                  row.data[COLUMNS[TreasuryTenor.ThreeMonths]],
                [TreasuryTenor.TwoYears]:
                  row.data[COLUMNS[TreasuryTenor.TwoYears]],
                [TreasuryTenor.TenYears]:
                  row.data[COLUMNS[TreasuryTenor.TenYears]],
                [TreasuryTenor.ThirtyYears]:
                  row.data[COLUMNS[TreasuryTenor.ThirtyYears]],
              },
            },
          ]
        : [];
    });
  }

  return {
    id: "treasury",

    async curves(since) {
      const first = Number(since.slice(0, 4));
      const last = now().getUTCFullYear();

      const years = await Promise.all(
        range(first, last + 1).map((each) => year(each))
      );

      return sortBy(
        years.flat().filter(({ date }) => date >= since),
        [({ date }) => date]
      );
    },
  };
}
