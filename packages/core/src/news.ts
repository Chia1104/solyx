import { groupBy, sumBy } from "es-toolkit";

import type { Listing } from "./market-data.ts";
import { exchangeDate, symbolKey } from "./market.ts";
import type { Market, SymbolRef } from "./market.ts";
import { TextKind, TextTopic, stanceValue } from "./sentiment.ts";
import type { SentimentScore } from "./sentiment.ts";

/** Where items were published, which decides whose voice they carry. */
export const NewsChannel = {
  /** Material information the company files with the exchange. */
  Announcement: "announcement",
  /** News outlets' articles. */
  Article: "article",
  /** Stock forums, such as PTT's Stock board. */
  Forum: "forum",
  /** Social networks, such as Threads and X. */
  Social: "social",
} as const;

export type NewsChannel = (typeof NewsChannel)[keyof typeof NewsChannel];

/** How exactly a source tells when an item was published. */
export const TimePrecision = {
  /** To the minute, such as a filing's time or a post id's. */
  Minute: "minute",
  /** To about an hour, such as a search engine's "3 hours ago". */
  Hour: "hour",
  /** Only the day, such as "2 days ago" or a date without a time. */
  Day: "day",
} as const;

export type TimePrecision = (typeof TimePrecision)[keyof typeof TimePrecision];

export interface Published {
  /** Exact only to its precision; a date given without a time is the start of that day on the exchange's calendar. */
  at: Date;
  precision: TimePrecision;
}

/** An announcement, article or post a news source found. */
export interface NewsItem {
  /** Identifies it within its source, such as its address, so finding it again recognizes it. */
  id: string;
  /** `null` when the source has no page for it. */
  url: string | null;
  title: string;
  /** What the source shows of it, such as a search snippet, rather than the whole text. */
  snippet: string;
  /** The host it was published on, without `www.`. */
  site: string;
  /** `null` when the source gives no time it can be read from. */
  published: Published | null;
  /** Net votes where the source counts them, such as PTT's pushes minus boos. */
  votes: number | null;
}

/** The listing news is about. */
export interface NewsSubject {
  symbol: SymbolRef;
  /** The exchange's names for it, which articles use more often than the code; `null` until known. */
  listing: Listing | null;
}

export interface NewsQuery extends NewsSubject {
  /** The earliest publication day to include. */
  since: Date;
  limit: number;
}

/** Finds items about a listing; one implementation per source (`@solyx/news/*`), main process only. */
export interface NewsSource {
  readonly id: string;
  readonly channel: NewsChannel;
  readonly markets: readonly Market[];
  search(query: NewsQuery): Promise<NewsItem[]>;
}

/** An item stored for a listing: where it came from and, once judged, the decisions model's reading. */
export interface NewsRecord {
  source: string;
  channel: NewsChannel;
  item: NewsItem;
  /** When a search first found it for the listing. */
  foundAt: Date;
  score: SentimentScore | null;
}

/** How a source's searches have gone, so a quiet listing can be told from a broken source. */
export interface SourceHealth {
  source: string;
  /** `null` before a search of it first works. */
  lastSuccessAt: Date | null;
  /** `null` before a search of it first fails. */
  lastFailureAt: Date | null;
  /** Searches that failed since the last that worked. */
  failureStreak: number;
  /** The latest failure's message. */
  lastError: string | null;
}

/** Keeps what sources found per listing, so history outlives each source's window. */
export interface NewsStore {
  /**
   * Stores what a source found for a listing. An item stored before keeps its score and the first
   * publication time it was given, and takes the latest title, snippet and votes.
   */
  save(
    symbol: SymbolRef,
    source: Pick<NewsSource, "id" | "channel">,
    items: readonly NewsItem[],
    foundAt: Date
  ): void;
  /** Stores the decisions model's reading of a record's item for the listing. */
  saveScore(symbol: SymbolRef, record: NewsRecord, score: SentimentScore): void;
  /** A listing's records published since `since`, or found since then when undated, newest first. */
  list(symbol: SymbolRef, since: Date): NewsRecord[];
  /** When news was last collected for a listing; `null` before the first time. */
  lastCollected(symbol: SymbolRef): Date | null;
  markCollected(symbol: SymbolRef, at: Date): void;
  /** Records how a search of a source went: the failure's message, or `null` when it worked. */
  markSearched(source: string, at: Date, error: string | null): void;
  /** Every source searched so far. */
  sourceHealth(): SourceHealth[];
}

/**
 * Records of one voice that tell the same story, such as an article's reprints, a thread's replies
 * or several outlets reporting one event.
 */
export interface NewsStory {
  /** Its lead's. */
  channel: NewsChannel;
  /** The record it is shown and judged by: the earliest scored one, or else the earliest. */
  lead: NewsRecord;
  /** Every record that tells it, the lead among them, earliest first. */
  records: NewsRecord[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Replies and forwards repeat the title they answer, as PTT's `Re:` and `Fw:` do.
const REPLY_PREFIX = /^(?:(?:re|fw|fwd)\s*:\s*)+/i;

// A title shorter than this, such as a lone company name, says too little to tell items apart.
const STORY_TITLE_MIN = 8;

// Records whose titles match but lie further apart than this are separate stories.
const STORY_GAP_MS = 3 * DAY_MS;

// Reworded titles tell one story only this close together, or on one exchange day when either is
// dated only by its day.
const RETOLD_WINDOW_MS = DAY_MS;

// The share of the shorter title's letter pairs that two reworded titles of one story share.
const RETOLD_OVERLAP = 0.4;

// A title with fewer letter pairs than this, once the listing's names are gone, says too little.
const RETOLD_MIN_PAIRS = 4;

// Where a site sets its own label apart from the headline, as in `Headline - Site` or `Site | Headline`.
const TITLE_SEPARATOR = /\s+[-–—]\s*|\s*[-–—]\s+|\s*[|｜]\s*/u;

// A bracketed tag, such as PTT's [新聞] or a column's 【盤前】, names a post's kind, not its story.
const TITLE_TAG = /[[【][^\]】]{1,8}[\]】]/gu;

/** Undated records count from when they were found. */
const datedAt = (record: NewsRecord) =>
  record.item.published?.at ?? record.foundAt;

/** The title's letters and digits without reply prefixes; `null` when too short to compare. */
function storyTitle(title: string): string | null {
  const letters = title
    .normalize("NFKC")
    .trim()
    .replace(REPLY_PREFIX, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

  return letters.length >= STORY_TITLE_MIN ? letters : null;
}

/** A title's parts between separators, without reply prefixes. */
function titleSegments(title: string): string[] {
  return title
    .normalize("NFKC")
    .trim()
    .replace(REPLY_PREFIX, "")
    .split(TITLE_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
}

/**
 * Two titles from one site without the leading and trailing segments they share, which the site
 * sets around every headline it publishes.
 */
function withoutSiteLabels(
  a: readonly string[],
  b: readonly string[]
): [string[], string[]] {
  let start = 0;
  let end = 0;

  while (
    start < a.length - 1 &&
    start < b.length - 1 &&
    a[start] === b[start]
  ) {
    start += 1;
  }

  while (
    end < a.length - 1 - start &&
    end < b.length - 1 - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end += 1;
  }

  return [a.slice(start, a.length - end), b.slice(start, b.length - end)];
}

/** The consecutive letter pairs of what segments say beyond their tags and the listing's names. */
function letterPairs(
  segments: readonly string[],
  names: readonly string[]
): Set<string> {
  let text = segments.join(" ").replace(TITLE_TAG, "").toLowerCase();

  for (const name of names) text = text.replaceAll(name, "");

  const letters = [...text.replace(/[^\p{L}\p{N}]/gu, "")];

  return new Set(letters.slice(1).map((letter, i) => letters[i] + letter));
}

/** Whether two records came out close enough together to report one event. */
function closeInTime(a: NewsRecord, b: NewsRecord, market: Market): boolean {
  const byDayOnly = [a, b].some(
    ({ item: { published } }) =>
      published === null || published.precision === TimePrecision.Day
  );

  return byDayOnly
    ? exchangeDate(market, datedAt(a)) === exchangeDate(market, datedAt(b))
    : Math.abs(datedAt(a).getTime() - datedAt(b).getTime()) <= RETOLD_WINDOW_MS;
}

/**
 * Whether two records of one voice, out close together, word one story differently: most of the
 * shorter title's letter pairs recur in the other once the listing's names, tags and the labels a
 * site sets around its headlines are gone, since those alone make unrelated titles look alike.
 */
function retold(
  a: NewsRecord,
  b: NewsRecord,
  market: Market,
  names: readonly string[]
): boolean {
  if (CHANNEL_VOICE[a.channel] !== CHANNEL_VOICE[b.channel]) return false;

  if (!closeInTime(a, b, market)) return false;

  let segments = [titleSegments(a.item.title), titleSegments(b.item.title)];

  if (a.item.site === b.item.site) {
    segments = withoutSiteLabels(segments[0], segments[1]);
  }

  const [pairsA, pairsB] = segments.map((each) => letterPairs(each, names));

  if (pairsA.size < RETOLD_MIN_PAIRS || pairsB.size < RETOLD_MIN_PAIRS) {
    return false;
  }

  const shared = [...pairsA].filter((pair) => pairsB.has(pair)).length;

  return shared / Math.min(pairsA.size, pairsB.size) >= RETOLD_OVERLAP;
}

/**
 * Groups the records that tell the same story, newest story first, so a story told many times is
 * weighed once. Records of one channel whose titles read the same are one story, as reprints and a
 * thread's replies are. Once the exchange's names for the listing are known, records of one voice
 * whose titles are reworded from each other within a day are one story too, as several outlets
 * reporting one event are; without them every title names the listing and reads alike.
 */
function newsStories(
  records: readonly NewsRecord[],
  { symbol, listing }: NewsSubject
): NewsStory[] {
  const sorted = records.toSorted(
    (a, b) => datedAt(a).getTime() - datedAt(b).getTime()
  );

  const parent = sorted.map((_, index) => index);

  const root = (index: number): number => {
    let at = index;

    while (parent[at] !== at) {
      parent[at] = parent[parent[at]];
      at = parent[at];
    }

    return at;
  };

  const join = (a: number, b: number) => {
    parent[root(a)] = root(b);
  };

  const latest = new Map<string, number>();

  for (const [index, record] of sorted.entries()) {
    const title = storyTitle(record.item.title);

    if (title === null) continue;

    const key = `${record.channel}:${title}`;
    const last = latest.get(key);

    if (
      last !== undefined &&
      datedAt(record).getTime() - datedAt(sorted[last]).getTime() <=
        STORY_GAP_MS
    ) {
      join(index, last);
    }

    latest.set(key, index);
  }

  if (listing) {
    const names = [symbol.symbol, listing.name, listing.englishName].flatMap(
      (name) => (name ? [name.normalize("NFKC").toLowerCase()] : [])
    );

    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const apart =
          datedAt(sorted[j]).getTime() - datedAt(sorted[i]).getTime();

        // Sorted by time, so nothing later is close enough either.
        if (apart > RETOLD_WINDOW_MS) break;

        if (
          root(i) !== root(j) &&
          retold(sorted[i], sorted[j], symbol.market, names)
        ) {
          join(i, j);
        }
      }
    }
  }

  return Object.values(groupBy([...sorted.keys()], (index) => root(index)))
    .map((indices) => {
      const group = indices.map((index) => sorted[index]);
      const lead = group.find((record) => record.score) ?? group[0];

      return { channel: lead.channel, lead, records: group };
    })
    .toSorted((a, b) => datedAt(b.lead).getTime() - datedAt(a.lead).getTime());
}

export interface NewsCollection {
  /** Each channel's newest stories, up to the limit asked for, newest first. */
  stories: NewsStory[];
  /** Over everything stored about the listing since the collection's start, as scored by its end. */
  gauge: SentimentGauge;
  /** Oldest first, over the same stories as `gauge`. */
  daily: SentimentDay[];
  /** Sources whose search failed this time, with how their searches have gone; what they stored before is still among `stories`. */
  failures: SourceHealth[];
  /** False while the user has no decisions model, so nothing was scored. */
  scored: boolean;
}

/**
 * A listing's news on request: every source covering its market searched now, what each finds
 * stored with how its search went, and each channel's newest stories scored once however often
 * and wherever they are found.
 */
export interface NewsDesk {
  /** Searches for up to `limit` items a source; rejects when no source covers the listing's market. */
  collect(
    symbol: SymbolRef,
    since: Date,
    limit: number
  ): Promise<NewsCollection>;
}

/** Below this relevance an item only names the listing in passing. */
export const RELEVANCE_FLOOR = 0.5;

/** Whose voice a channel carries. */
export const NewsVoice = {
  /** Companies and news outlets: announcements and articles. */
  Press: "press",
  /** Investors themselves: forum and social posts. */
  Crowd: "crowd",
} as const;

export type NewsVoice = (typeof NewsVoice)[keyof typeof NewsVoice];

export const CHANNEL_VOICE: Record<NewsChannel, NewsVoice> = {
  [NewsChannel.Announcement]: NewsVoice.Press,
  [NewsChannel.Article]: NewsVoice.Press,
  [NewsChannel.Forum]: NewsVoice.Crowd,
  [NewsChannel.Social]: NewsVoice.Crowd,
};

/** Whether a story is about the listing: its lead scored above the relevance floor, or not scored yet. */
export function isAboutListing({ lead: { score } }: NewsStory): boolean {
  return !score || score.relevance >= RELEVANCE_FLOOR;
}

/** A stance from −1 to 1 on the gauge's scale, 0 to 100 with 50 neutral. */
const gaugeScore = (stance: number) => Math.round((stance + 1) * 50);

/** How a story reads on the gauge's scale; `null` until it is scored. */
export function storyScore({ lead: { score } }: NewsStory): number | null {
  return score ? gaugeScore(stanceValue(score.stance)) : null;
}

interface Weighed {
  /** From −1 to 1; `null` when none of the stories is scored. */
  stance: number | null;
  weight: number;
  stories: number;
}

/**
 * The stories' stance, each scored one weighed by how surely it is about the listing and is not
 * a promotion. Expects stories about the listing only.
 */
function weigh(stories: readonly NewsStory[]): Weighed {
  const weighed = stories.flatMap(({ lead: { score } }) =>
    score
      ? [
          {
            stance: stanceValue(score.stance),
            weight: score.relevance * (1 - score.kind[TextKind.Promotion]),
          },
        ]
      : []
  );

  const weight = sumBy(weighed, (entry) => entry.weight);

  return {
    stance:
      weight > 0
        ? sumBy(weighed, (entry) => entry.stance * entry.weight) / weight
        : null,
    weight,
    stories: stories.length,
  };
}

/** One exchange-local day of what was said about a listing. */
export interface SentimentDay {
  /** `YYYY-MM-DD` on the exchange's calendar. */
  date: string;
  /** From −1 to 1; `null` when none of the day's stories is scored. */
  stance: number | null;
  /** The sum of the stories' weights, so days can be merged into longer periods. */
  weight: number;
  /** Stories about the listing, scored or not. */
  stories: number;
}

/**
 * Each day with stories about the listing, oldest first, by when each story's lead was published,
 * or found when undated. Expects stories about the listing only.
 */
function dailySentiment(
  market: Market,
  about: readonly NewsStory[]
): SentimentDay[] {
  const days = groupBy(about, (story) =>
    exchangeDate(market, datedAt(story.lead))
  );

  return Object.entries(days)
    .map(([date, dayStories]) => ({ date, ...weigh(dayStories) }))
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

export interface SentimentReading {
  /** 0 to 100 with 50 neutral, from the weighted stance; `null` when nothing is scored. */
  score: number | null;
  /** Stories about the listing, scored or not. */
  stories: number;
}

export interface SentimentGauge {
  overall: SentimentReading;
  voices: Record<NewsVoice, SentimentReading>;
}

function reading(stories: readonly NewsStory[]): SentimentReading {
  const { stance, stories: count } = weigh(stories);

  return {
    score: stance === null ? null : gaugeScore(stance),
    stories: count,
  };
}

/** How the stories about a listing read on a 0-to-100 scale, overall and in each voice. */
function sentimentGauge(about: readonly NewsStory[]): SentimentGauge {
  return {
    overall: reading(about),
    voices: {
      [NewsVoice.Press]: reading(
        about.filter(
          ({ channel }) => CHANNEL_VOICE[channel] === NewsVoice.Press
        )
      ),
      [NewsVoice.Crowd]: reading(
        about.filter(
          ({ channel }) => CHANNEL_VOICE[channel] === NewsVoice.Crowd
        )
      ),
    },
  };
}

/** What is stored about a listing, read once. */
export interface NewsReading {
  /** Newest first. */
  stories: NewsStory[];
  /** Over the stories about the listing. */
  gauge: SentimentGauge;
  /** Oldest first, over the stories about the listing. */
  daily: SentimentDay[];
}

/**
 * Groups a listing's records into stories once, by its names when they are known, and reads the
 * gauge and each day's stance from the stories about it, so every view of the listing counts the
 * same stories.
 */
export function readNews(
  records: readonly NewsRecord[],
  subject: NewsSubject
): NewsReading {
  const stories = newsStories(records, subject);
  const about = stories.filter(isAboutListing);

  return {
    stories,
    gauge: sentimentGauge(about),
    daily: dailySentiment(subject.symbol.market, about),
  };
}

/** A story about one or more listings, ranked against the others. */
export interface Headline {
  /** The story as told about the listing it weighs most for. */
  story: NewsStory;
  /** Every listing it is about, the one it weighs most for first. */
  symbols: SymbolRef[];
  /** Zero or more, and comparable only among headlines ranked together. */
  weight: number;
}

// The company's own filings outrank the press, and the press the crowd.
const CHANNEL_WEIGHT: Record<NewsChannel, number> = {
  [NewsChannel.Announcement]: 1,
  [NewsChannel.Article]: 0.8,
  [NewsChannel.Forum]: 0.5,
  [NewsChannel.Social]: 0.4,
};

// How directly each topic bears on what the shares are worth.
const TOPIC_WEIGHT: Record<TextTopic, number> = {
  [TextTopic.Earnings]: 1,
  [TextTopic.Guidance]: 1,
  [TextTopic.Capital]: 0.8,
  [TextTopic.Legal]: 0.8,
  [TextTopic.Business]: 0.6,
  [TextTopic.Analyst]: 0.6,
  [TextTopic.Market]: 0.3,
  [TextTopic.Other]: 0.3,
};

// An unscored story reads as a relevant, neutral story about the business would.
const UNSCORED_READING = TOPIC_WEIGHT[TextTopic.Business] / 2;

const HEADLINE_HALF_LIFE_MS = 2 * DAY_MS;

/** How much a story's reading says it bears on the share price, from 0 to 1. */
function storyReading({ lead: { score } }: NewsStory): number {
  if (!score) return UNSCORED_READING;

  const material = sumBy(
    Object.values(TextTopic),
    (topic) => score.topic[topic] * TOPIC_WEIGHT[topic]
  );

  // A neutral story counts half as much as one that clearly reads either way.
  const strength = (1 + Math.abs(stanceValue(score.stance))) / 2;

  return (
    score.relevance * (1 - score.kind[TextKind.Promotion]) * material * strength
  );
}

/** A story's weight at `now`: its channel and reading, how often it was told and how recent it is. */
function storyWeight(story: NewsStory, now: Date): number {
  const age = Math.max(0, now.getTime() - datedAt(story.lead).getTime());

  return (
    CHANNEL_WEIGHT[story.channel] *
    storyReading(story) *
    Math.log2(1 + story.records.length) *
    0.5 ** (age / HEADLINE_HALF_LIFE_MS)
  );
}

const recordKey = ({ source, item }: NewsRecord) => `${source}:${item.id}`;

/** A listing and what is stored about it. */
export interface ListingNews {
  subject: NewsSubject;
  records: readonly NewsRecord[];
}

/**
 * The stories about each listing as headlines, heaviest first. Stories that share an item, as one
 * found for several listings does, make one headline, so a story about many of them counts once.
 */
export function rankHeadlines(
  listings: readonly ListingNews[],
  now: Date
): Headline[] {
  const told = listings
    .flatMap(({ subject, records }) =>
      newsStories(records, subject)
        .filter(isAboutListing)
        .map((story) => ({
          symbol: subject.symbol,
          story,
          weight: storyWeight(story, now),
        }))
    )
    .toSorted((a, b) => b.weight - a.weight);

  const headlines: Headline[] = [];
  const byItem = new Map<string, Headline>();

  for (const { symbol, story, weight } of told) {
    const keys = story.records.map(recordKey);

    let headline = keys
      .map((key) => byItem.get(key))
      .find((each) => each !== undefined);

    if (headline === undefined) {
      headline = { story, symbols: [symbol], weight };
      headlines.push(headline);
    } else if (
      !headline.symbols.some((each) => symbolKey(each) === symbolKey(symbol))
    ) {
      headline.symbols.push(symbol);
    }

    for (const key of keys) if (!byItem.has(key)) byItem.set(key, headline);
  }

  return headlines;
}
