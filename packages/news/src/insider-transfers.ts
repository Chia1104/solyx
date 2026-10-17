import { mapKeys, orderBy } from "es-toolkit";
import ky from "ky";
import * as z from "zod";

import { Market, exchangeMidnight } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { NewsItem, NewsQuery, NewsSource } from "@solyx/core/news";
import { twRocDaySchema } from "@solyx/core/rules/tw";

// Each lists the transfers declared the day before, for listed and OTC companies.
const TWSE_FEED = "https://openapi.twse.com.tw/v1/opendata/t187ap12_L";

const TPEX_FEED = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap12_O";

// The exchanges pad some values with spaces.
const textSchema = z.string().trim();

const sharesSchema = textSchema.regex(/^\d+$/).transform(Number);

const transferFields = {
  姓名: textSchema.min(1),
  "預定轉讓方式及股數-轉讓方式": textSchema,
  受讓人: textSchema.catch(""),
  "目前持有股數-自有持股": sharesSchema,
  "目前持有股數-保留運用決定權信託股數": sharesSchema,
  "預定轉讓總股數-自有持股": sharesSchema,
  "預定轉讓總股數-保留運用決定權信託股數": sharesSchema,
  "預定轉讓後持股-自有持股": sharesSchema,
  "預定轉讓後持股-保留運用決定權信託股數": sharesSchema,
  有效轉讓期間: textSchema,
};

// The feeds name the company, the day and who declares differently; keys are trimmed first.
const twseRowSchema = z
  .object({
    公司代號: textSchema,
    出表日期: twRocDaySchema,
    申報人身分: textSchema,
    ...transferFields,
  })
  .transform(({ 公司代號, 出表日期, 申報人身分, ...row }) => ({
    code: 公司代號,
    date: 出表日期,
    role: 申報人身分,
    ...row,
  }));

const tpexRowSchema = z
  .object({
    SecuritiesCompanyCode: textSchema,
    Date: twRocDaySchema,
    申請人身分: textSchema,
    ...transferFields,
  })
  .transform(({ SecuritiesCompanyCode, Date, 申請人身分, ...row }) => ({
    code: SecuritiesCompanyCode,
    date: Date,
    role: 申請人身分,
    ...row,
  }));

type TransferRow = z.infer<typeof twseRowSchema>;

const feedSchema = z.array(z.record(z.string(), z.unknown()));

const shares = (count: number) => count.toLocaleString("en-US");

/** The start of the day a declaration is listed under, on Taipei's calendar, since the feeds give no time. */
const listedAt = ({ date }: TransferRow) =>
  new Date(exchangeMidnight(Market.TW, date) * 1000);

/** A declaration as an item: who declares what in its title, and the holding around it, in the list's own words, as its snippet. */
function transferItem(row: TransferRow): NewsItem {
  const held =
    row["目前持有股數-自有持股"] + row["目前持有股數-保留運用決定權信託股數"];

  const declared =
    row["預定轉讓總股數-自有持股"] +
    row["預定轉讓總股數-保留運用決定權信託股數"];

  const left =
    row["預定轉讓後持股-自有持股"] +
    row["預定轉讓後持股-保留運用決定權信託股數"];

  const method = row["預定轉讓方式及股數-轉讓方式"];

  return {
    // A declaration has no address; who declares, what and to whom tell it apart.
    id: [row.code, row.date, row.姓名, method, declared, row.受讓人, held].join(
      ":"
    ),
    url: null,
    title: `內部人持股轉讓事前申報：${row.role} ${row.姓名}，${method} ${shares(declared)} 股`,
    snippet: [
      `目前持有股數 ${shares(held)}`,
      `預定轉讓總股數 ${shares(declared)}`,
      `預定轉讓後持股 ${shares(left)}`,
      ...(row.受讓人 ? [`受讓人 ${row.受讓人}`] : []),
      `有效轉讓期間 ${row.有效轉讓期間}`,
    ].join("；"),
    site: "mops.twse.com.tw",
    published: { at: listedAt(row), precision: TimePrecision.Day },
    votes: null,
  };
}

export interface InsiderTransfersOptions {
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
}

/**
 * The transfers of their own shares that directors, managers and large shareholders of Taiwan
 * companies declare before making them, from TWSE's and TPEx's open data. Each feed holds only
 * the latest day and gives it without a time, so older declarations are not found.
 */
export function createInsiderTransfers(
  options: InsiderTransfersOptions = {}
): NewsSource {
  const http = ky.create({ fetch: options.fetch });

  async function rows(
    url: string,
    rowSchema: z.ZodType<TransferRow>
  ): Promise<TransferRow[]> {
    const feed = feedSchema.parse(await http.get(url).json());

    return feed.flatMap((row) => {
      const parsed = rowSchema.safeParse(mapKeys(row, (_, key) => key.trim()));

      return parsed.success ? [parsed.data] : [];
    });
  }

  return {
    id: "insider-transfers",
    channel: NewsChannel.Announcement,
    markets: [Market.TW],

    async search({ symbol, since, limit }: NewsQuery) {
      const feeds = await Promise.all([
        rows(TWSE_FEED, twseRowSchema),
        rows(TPEX_FEED, tpexRowSchema),
      ]);

      const declared = feeds
        .flat()
        .filter((row) => row.code === symbol.symbol && listedAt(row) >= since);

      return orderBy(declared, [({ date }) => date], ["desc"])
        .slice(0, limit)
        .map(transferItem);
    },
  };
}
