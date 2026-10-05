import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";
import type { Fetch } from "@typesafe-ai/sdk";

import { Stance, TextKind, TextTopic } from "@solyx/core/sentiment";
import type {
  SentimentInput,
  SentimentScore,
  SentimentScorer,
} from "@solyx/core/sentiment";

/** Pinned rather than `jev-latest`, so the questions keep the behaviour they were written against. */
export const TYPESAFE_DEFAULT_MODEL = "jev-1.13.0";

export const TYPESAFE_BASE_URL = "https://api.typesafe.ai";

// Jev reads at most 32k tokens of state plus the longest question, and Chinese runs close to a
// token per character.
const MAX_TEXT_LENGTH = 12_000;

// Jev is weak on negation, so each question and option says what the text does.
const QUESTIONS = {
  relevance: noul(
    "Is `text` about the company in `listing`, its business or its shares? The text may be in Chinese or English and may name the company by its code, its name or a nickname.",
    {
      true: "The company is the subject of the text or one of a few companies it discusses in detail.",
      false:
        "The company appears only in passing, in a list of many companies, or not at all.",
    }
  ),
  stance: score(
    "How does `text` bear on the share price of the company in `listing`?",
    [
      "Clearly bad news for the share price, or expects it to fall",
      "Somewhat bad news, or leans towards a fall",
      "Neither good nor bad, mixed, or unrelated to the share price",
      "Somewhat good news, or leans towards a rise",
      "Clearly good news for the share price, or expects it to rise",
    ]
  ),
  kind: choice("What kind of text is `text`?", {
    [TextKind.Report]:
      "Reports facts or announcements without a view of its own, as a news report, press release or filing does",
    [TextKind.Opinion]: "A person's own view, analysis, prediction or reaction",
    [TextKind.Promotion]:
      "Pushes readers to buy or sell, as paid signals, stock-tip groups or advertising do",
  }),
  topic: choice("What does `text` mainly say about the company in `listing`?", {
    [TextTopic.Earnings]:
      "Reported results: revenue, including monthly revenue, profit, margins or earnings per share",
    [TextTopic.Guidance]:
      "The company's outlook or forecasts, including what it said at an investor conference or earnings call",
    [TextTopic.Business]:
      "Orders, customers, products, capacity, investment, partnerships or acquisitions",
    [TextTopic.Capital]:
      "Dividends, buybacks, share issues, splits or major shareholders' trades",
    [TextTopic.Analyst]:
      "Analysts' or brokers' ratings, target prices or estimates",
    [TextTopic.Legal]:
      "Regulation, lawsuits, sanctions, export controls or other government action",
    [TextTopic.Market]:
      "The market, the sector or the economy, fund flows such as foreign investors' buying, or the share's price moves and chart",
    [TextTopic.Other]: "Something else",
  }),
};

// Each asks for what the command does, since Jev is weak on negation; a command is harmless only
// when every answer is unlikely.
const COMMAND_QUESTIONS = {
  changes: noul(
    "Does `command`, a `shell` command, create, change, move or delete any file or folder, install anything, or change a setting or a running program?",
    {
      true: "At least one part of it writes, appends, redirects output into a file, moves, renames, deletes, installs, changes permissions, or stops or starts a program.",
      false:
        "Every part of it only reads, lists, searches, counts, compares or prints.",
    }
  ),
  network: noul(
    "Does `command`, a `shell` command, send or receive anything over the network?",
    {
      true: "At least one part of it contacts another computer: downloads, uploads, calls a web address, opens a connection, or pushes or pulls from a remote.",
      false: "Every part of it works only with this computer's own files.",
    }
  ),
  secrets: noul(
    "Does `command`, a `shell` command, read passwords, keys, tokens, credentials, environment variables, browser or shell history, or an application's private data or databases?",
    {
      true: "At least one part of it reads a place where secrets or private application data are kept, such as SSH or cloud credentials, .env files, the keychain, the environment, or an app's support folder.",
      false:
        "Every file it reads is an ordinary document, data file, script or note.",
    }
  ),
  runs: noul(
    "Does `command`, a `shell` command, run a script, a program the user wrote, an interpreter with code, or another command built from text or data?",
    {
      true: "At least one part of it runs code whose effect the command line alone does not show: a script file, an interpreter such as python or node given code or a file, eval, a pipe into a shell, or a command built by another command.",
      false:
        "Every part of it is a standard tool whose effect its own arguments show.",
    }
  ),
  privileged: noul(
    "Does `command`, a `shell` command, run anything with more rights than the user's own, or as another user?",
    {
      true: "At least one part of it raises its rights or switches user, such as sudo, su, doas, runas or an elevated shell.",
      false: "Every part of it runs with the user's own ordinary rights.",
    }
  ),
};

/** How likely a shell command does each thing that makes it unsafe to run unasked, from 0 to 1. */
export interface CommandJudgement {
  model: string;
  changes: number;
  network: number;
  secrets: number;
  runs: number;
  privileged: number;
}

export interface TypeSafeOptions {
  apiKey: string;
  model: string;
  baseURL: string;
  /** @default globalThis.fetch */
  fetch?: Fetch;
}

/** Judges shell commands with a TypeSafe System One model, such as Jev, on the user's own key. */
export function createTypeSafeCommandJudge(options: TypeSafeOptions) {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultModel: options.model,
    logLevel: "off",
    fetch: options.fetch,
  });

  return {
    async judge(
      input: { command: string; shell: string },
      { signal }: { signal?: AbortSignal } = {}
    ): Promise<CommandJudgement> {
      const { model, answers } = await client.systemOne(
        {
          model: options.model,
          state: {
            shell: input.shell,
            command: input.command.slice(0, MAX_TEXT_LENGTH),
          },
          questions: COMMAND_QUESTIONS,
        },
        { signal }
      );

      return {
        model,
        changes: answers.changes.noul,
        network: answers.network.noul,
        secrets: answers.secrets.noul,
        runs: answers.runs.noul,
        privileged: answers.privileged.noul,
      };
    },
  };
}

/** Scores texts with a TypeSafe System One model, such as Jev, on the user's own key. */
export function createTypeSafeScorer(
  options: TypeSafeOptions
): SentimentScorer {
  // Each setting is passed so none falls back to a TYPESAFE_* environment variable: the key and
  // endpoint come only from the user's settings, and debug logging would print texts.
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultModel: options.model,
    // Failures reach the caller as errors.
    logLevel: "off",
    fetch: options.fetch,
  });

  return {
    async score(
      input: SentimentInput,
      { signal }: { signal?: AbortSignal } = {}
    ): Promise<SentimentScore> {
      const { model, answers } = await client.systemOne(
        {
          model: options.model,
          state: {
            listing: {
              market: input.symbol.market,
              code: input.symbol.symbol,
              name: input.listing?.name ?? null,
              englishName: input.listing?.englishName ?? null,
            },
            title: input.title ?? null,
            text: input.text.slice(0, MAX_TEXT_LENGTH),
          },
          questions: QUESTIONS,
        },
        { signal }
      );

      const levels = answers.stance.probabilities;

      return {
        model,
        relevance: answers.relevance.noul,
        stance: {
          [Stance.Negative]: levels[0],
          [Stance.LeanNegative]: levels[1],
          [Stance.Neutral]: levels[2],
          [Stance.LeanPositive]: levels[3],
          [Stance.Positive]: levels[4],
        },
        kind: { ...answers.kind.probabilities },
        topic: { ...answers.topic.probabilities },
      };
    },
  };
}
