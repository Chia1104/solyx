import { mapKeys, orderBy } from "es-toolkit";
import ky from "ky";
import * as z from "zod";

import { Market, exchangeMidnight } from "@solyx/core/market";
import { NewsChannel } from "@solyx/core/news";
import type { NewsQuery, NewsSource } from "@solyx/core/news";

// Each lists the previous day's material information, for listed and OTC companies.
const TWSE_FEED = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L";

const TPEX_FEED = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O";

const announcementFields = {
  發言日期: z.string(),
  發言時間: z.string(),
  主旨: z.string(),
  說明: z.string().catch(""),
};

// The feeds name the company code differently; keys are trimmed first, since TWSE's 主旨 ends in a space.
const twseRowSchema = z
  .object({ 公司代號: z.string(), ...announcementFields })
  .transform(({ 公司代號, ...row }) => ({ code: 公司代號, ...row }));

const tpexRowSchema = z
  .object({ SecuritiesCompanyCode: z.string(), ...announcementFields })
  .transform(({ SecuritiesCompanyCode, ...row }) => ({
    code: SecuritiesCompanyCode,
    ...row,
  }));

type AnnouncementRow = z.infer<typeof twseRowSchema>;

const feedSchema = z.array(z.record(z.string(), z.unknown()));

/** When it was announced, from the ROC date (`1151002`) and time (`70003`) on Taipei's clock. */
function announcedAt(date: string, time: string): Date {
  const [year, month, day] = [
    date.slice(0, -4),
    date.slice(-4, -2),
    date.slice(-2),
  ];

  const midnight = exchangeMidnight(
    Market.TW,
    `${Number(year) + 1911}-${month}-${day}`
  );

  const clock = time.padStart(6, "0");

  const seconds =
    Number(clock.slice(0, 2)) * 3600 +
    Number(clock.slice(2, 4)) * 60 +
    Number(clock.slice(4));

  return new Date((midnight + seconds) * 1000);
}

export interface AnnouncementsOptions {
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
}

/**
 * Material information Taiwan companies file through MOPS, from TWSE's and TPEx's open data. Each
 * feed holds only the latest day, so older announcements are not found.
 */
export function createAnnouncements(
  options: AnnouncementsOptions = {}
): NewsSource {
  const http = ky.create({ fetch: options.fetch });

  async function rows(
    url: string,
    rowSchema: z.ZodType<AnnouncementRow>
  ): Promise<AnnouncementRow[]> {
    const feed = feedSchema.parse(await http.get(url).json());

    return feed.flatMap((row) => {
      const parsed = rowSchema.safeParse(mapKeys(row, (_, key) => key.trim()));

      return parsed.success ? [parsed.data] : [];
    });
  }

  return {
    id: "mops-announcements",
    channel: NewsChannel.Announcement,
    markets: [Market.TW],

    async search({ symbol, since, limit }: NewsQuery) {
      const feeds = await Promise.all([
        rows(TWSE_FEED, twseRowSchema),
        rows(TPEX_FEED, tpexRowSchema),
      ]);

      const items = feeds
        .flat()
        .filter((row) => row.code.trim() === symbol.symbol)
        .map((row) => ({
          url: null,
          title: row.主旨.replace(/\s+/g, " ").trim(),
          snippet: row.說明.replace(/\r\n/g, "\n").trim(),
          site: "mops.twse.com.tw",
          publishedAt: announcedAt(row.發言日期, row.發言時間),
          votes: null,
        }))
        .filter((item) => item.publishedAt >= since);

      return orderBy(
        items,
        [(item) => item.publishedAt.getTime()],
        ["desc"]
      ).slice(0, limit);
    },
  };
}
