import { orderBy } from "es-toolkit";
import * as z from "zod";

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { NewsItem, NewsQuery, NewsSource } from "@solyx/core/news";
import type { LongbridgeApi } from "@solyx/market-data/longbridge-api";

/** What each form a US company files says it is, as the SEC names it. */
const FORMS = new Map([
  ["8-K", "current report of a material event"],
  ["8-K/A", "amended current report"],
  ["10-Q", "quarterly report"],
  ["10-Q/A", "amended quarterly report"],
  ["10-K", "annual report"],
  ["10-K/A", "amended annual report"],
  ["20-F", "a foreign issuer's annual report"],
  ["40-F", "a Canadian issuer's annual report"],
  ["6-K", "a foreign issuer's current report"],
  ["144", "an insider's notice of a proposed sale"],
  ["SCHEDULE 13D", "an active holder's report of more than 5%"],
  ["SCHEDULE 13D/A", "an active holder's amended report of more than 5%"],
  ["SCHEDULE 13G", "a passive holder's report of more than 5%"],
  ["SCHEDULE 13G/A", "a passive holder's amended report of more than 5%"],
  ["DEF 14A", "proxy statement for a shareholders' meeting"],
  ["DEFA14A", "additional proxy material"],
  ["S-1", "registration of a public offering"],
  ["S-3", "shelf registration of securities"],
  ["S-4", "registration of securities for a merger or exchange"],
  ["S-4/A", "amended registration for a merger or exchange"],
  ["S-8", "registration of shares for employee plans"],
  ["424B2", "prospectus for an offering"],
  ["424B3", "prospectus for an offering"],
  ["424B4", "prospectus for an offering"],
  ["424B5", "prospectus for an offering"],
  ["425", "communication about a business combination"],
  ["11-K", "an employee plan's annual report"],
  ["SD", "specialized disclosure, such as conflict minerals"],
  ["25-NSE", "notice of removal from listing"],
  ["EFFECT", "notice that a registration became effective"],
]);

// An insider's own report of what they hold names no holder, side or shares in its title, so
// it says nothing until the filing itself is read.
const OWNERSHIP_REPORTS = new Set(["3", "4", "5", "3/A", "4/A", "5/A"]);

const filingsSchema = z.object({ items: z.array(z.unknown()) });

/** A filing as Longbridge lists it: its title `name | form - filer (CIK) (role)`, the SEC's copies and when it was published, in UTC seconds. */
const filingSchema = z.object({
  id: z.string(),
  title: z.string(),
  file_urls: z.array(z.string()),
  publish_at: z.string().regex(/^\d+$/),
});

type Filing = z.infer<typeof filingSchema>;

/** The form a filing's title names, such as `8-K`; `undefined` for a title that names none. */
const formOf = (title: string) => /\|\s*(.+?)\s+-\s+/.exec(title)?.[1]?.trim();

export interface LongbridgeFilingsOptions {
  /** The sign-in's HTTP API, whose budget its other readers share. */
  api: LongbridgeApi;
}

function filingItem(filing: Filing, form: string): NewsItem {
  const url = filing.file_urls[0] ?? null;

  return {
    id: url ?? `longbridge:${filing.id}`,
    url,
    title: `${form}: ${FORMS.get(form) ?? "filing"}`,
    snippet: "",
    site: "sec.gov",
    published: {
      at: new Date(Number(filing.publish_at) * 1000),
      precision: TimePrecision.Minute,
    },
    votes: null,
  };
}

/**
 * The filings US companies make with the SEC, as Longbridge lists a listing's latest on the
 * user's sign-in, each linked to the SEC's copy. An insider's report of what they hold is left
 * out, since Longbridge's title tells nothing of it.
 */
export function createLongbridgeFilings({
  api,
}: LongbridgeFilingsOptions): NewsSource {
  async function filings(symbol: string): Promise<Filing[]> {
    const { items } = await api.read(
      "v1/quote/filings",
      { symbol: `${symbol}.US` },
      filingsSchema,
      `the filings of ${symbol}`
    );

    const read = items.flatMap((item) => {
      const parsed = filingSchema.safeParse(item);

      return parsed.success ? [parsed.data] : [];
    });

    if (items.length > 0 && read.length === 0) {
      throw new Error(
        `Longbridge: none of the ${items.length} filings of ${symbol} read as expected`
      );
    }

    return read;
  }

  return {
    id: "longbridge-filings",
    channel: NewsChannel.Announcement,
    markets: [Market.US],

    async search({ symbol, since, limit }: NewsQuery) {
      const listed = (await filings(symbol.symbol)).flatMap((filing) => {
        const form = formOf(filing.title);

        return form === undefined || OWNERSHIP_REPORTS.has(form)
          ? []
          : [filingItem(filing, form)];
      });

      return orderBy(
        listed.filter(({ published }) => published && published.at >= since),
        [({ published }) => published?.at.getTime() ?? 0],
        ["desc"]
      ).slice(0, limit);
    },
  };
}
