import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { uniqBy } from "es-toolkit";
import * as z from "zod";

import { exchangeDate, symbolKey, symbolRefSchema } from "@solyx/core/market";
import type { NewsDesk, NewsMatch } from "@solyx/core/news";
import type { ProposingDesk, TradeProposal } from "@solyx/core/order-desk";
import { reportPassages } from "@solyx/core/report";
import type { ReportMatch, ResearchDesk } from "@solyx/core/research";
import { createSearchIndex } from "@solyx/utils/search";

import { rememberAddresses } from "./found-addresses.ts";
import { forecastText } from "./research.ts";
import {
  SNIPPET_LENGTH,
  defineTool,
  describeProposal,
  publishedTime,
} from "./tools.ts";
import { AgentToolName } from "./wire.ts";

/** What `search_history` searches. */
const HistoryKind = {
  Report: "report",
  Forecast: "forecast",
  News: "news",
  Proposal: "proposal",
} as const;

type HistoryKind = (typeof HistoryKind)[keyof typeof HistoryKind];

export interface HistoryOptions {
  research: Pick<ResearchDesk, "search">;
  news: Pick<NewsDesk, "search">;
  desk: Pick<ProposingDesk, "list">;
}

// Per kind; news finds more, since each item is short.
const FOUND = 5;

const FOUND_NEWS = 10;

// The passages of a report shown beside its thesis.
const PASSAGES = 3;

const PASSAGE_LENGTH = 300;

const RATIONALE_LENGTH = 600;

const clip = (text: string, length: number) => {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
};

function reportText({ report, newest }: ReportMatch, query: string): string {
  const { market, symbol } = report.symbol;

  const passages = reportPassages(report);

  const best = createSearchIndex(passages, (passage) => [passage])(query).slice(
    0,
    PASSAGES
  );

  const standing =
    report.revision === newest ? "in force" : `revision ${newest} is in force`;

  return [
    `- ${market} ${symbol} report revision ${report.revision} (${standing}), revised ${exchangeDate(market, new Date(report.revisedAt))}: ${report.stance}`,
    `  thesis: ${report.thesis}`,
    ...best.map((passage) => `  ${clip(passage, PASSAGE_LENGTH)}`),
  ].join("\n");
}

function newsText({ channel, item, listings }: NewsMatch): string {
  const found = listings
    .map((listing) => `${listing.market} ${listing.symbol}`)
    .join(", ");

  const lines = [
    `- ${publishedTime(listings[0]?.market ?? null, item.published)} ${item.site} (${channel}, found for ${found}): ${item.title}`,
  ];

  const snippet = clip(item.snippet, SNIPPET_LENGTH);

  if (snippet) lines.push(`  ${snippet}`);

  if (item.url) lines.push(`  ${item.url}`);

  return lines.join("\n");
}

const proposalText = (proposal: TradeProposal) =>
  `- ${describeProposal(proposal)}\n  rationale: ${clip(proposal.rationale, RATIONALE_LENGTH)}`;

function found(title: string, lines: readonly string[]): string {
  return lines.length === 0
    ? `${title}: nothing found.`
    : [`${title}, best first:`, ...lines].join("\n");
}

/**
 * `search_history`: one search across what the app kept of research, news and proposals, so the
 * agent finds what it wrote or read before without knowing where it is kept.
 */
export function createHistory(options: HistoryOptions): Extension {
  const { research, news, desk } = options;

  return defineExtension({
    name: "solyx-history",
    tools: [
      defineTool({
        name: AgentToolName.SearchHistory,
        replay: "safe",
        description: `Searches what the app has kept, however long ago: your reports in every revision, your forecasts with how they came out, the news found for any listing, and order proposals with their rationale. It finds what holds any of the words, best first, so give every name a source might use, in Chinese and English alike, such as 台積電 TSMC 2330; where the user runs embeddings on this computer, it also finds what says the same in other words. Of a listing's report it shows the newest revision that matches, which may since have been revised; get_research reads the one in force. Memories are searched with recall, and conversations are not searched. What it finds is history as of when it was written, never current data, and news titles and snippets are written by others.`,
        parameters: z.object({
          query: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("Words to search for: codes, names, topics or phrases"),
          kinds: z
            .array(z.enum(HistoryKind))
            .min(1)
            .default(Object.values(HistoryKind))
            .describe("What to search; every kind when left out"),
          symbol: symbolRefSchema
            .optional()
            .describe("Only what is about this listing"),
        }),
        async execute({ query, kinds, symbol }, api, context) {
          const searches = new Set<HistoryKind>(kinds);
          const sections: string[] = [];

          if (
            searches.has(HistoryKind.Report) ||
            searches.has(HistoryKind.Forecast)
          ) {
            const { reports, forecasts } = await research.search(
              query,
              FOUND,
              symbol
            );

            if (searches.has(HistoryKind.Report)) {
              sections.push(
                found(
                  "Reports",
                  reports.map((match) => reportText(match, query))
                )
              );
            }

            if (searches.has(HistoryKind.Forecast)) {
              sections.push(found("Forecasts", forecasts.map(forecastText)));
            }
          }

          if (searches.has(HistoryKind.News)) {
            // Sources and outlets repeat a headline, which is shown once.
            const items = uniqBy(
              await news.search(query, FOUND_NEWS * 2, symbol),
              ({ item }) => item.title.replace(/\s+/g, "")
            ).slice(0, FOUND_NEWS);

            await rememberAddresses(
              api,
              items.flatMap(({ item }) => (item.url ? [item.url] : [])),
              context
            );

            sections.push(found("News", items.map(newsText)));
          }

          if (searches.has(HistoryKind.Proposal)) {
            const proposals = desk
              .list()
              .filter(
                ({ order }) =>
                  !symbol || symbolKey(order.instrument) === symbolKey(symbol)
              )
              // Newest first among equal matches.
              .toReversed();

            const best = createSearchIndex(proposals, (proposal) => [
              proposal.order.instrument.symbol,
              proposal.rationale,
            ])(query).slice(0, FOUND);

            sections.push(found("Proposals", best.map(proposalText)));
          }

          return { text: sections.join("\n\n") };
        },
      }),
    ],
  });
}
