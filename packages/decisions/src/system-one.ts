import { choice, noul, score } from "@typesafe-ai/sdk";
import type {
  ChoiceQuestion,
  NoulQuestion,
  ScoreQuestion,
  SystemOneRequest,
} from "@typesafe-ai/sdk";
import * as z from "zod";

import type { FactReader } from "@solyx/core/forecast";
import type { ClaimAuditor } from "@solyx/core/report";
import {
  Stance,
  TextKind,
  TextSpeaker,
  TextTopic,
} from "@solyx/core/sentiment";
import type {
  SentimentInput,
  SentimentScore,
  SentimentScorer,
} from "@solyx/core/sentiment";

import type { CodeJudge, CodeJudgement } from "./code.ts";
import type { CommandJudge, CommandJudgement } from "./command.ts";

/** A kind of question every vendor's model answers; System One's `box` has no counterpart elsewhere. */
export type SharedQuestion = NoulQuestion | ScoreQuestion | ChoiceQuestion;

/**
 * Sends a state and its questions, in TypeSafe's System One format, to a vendor's model. The
 * answers come back unread; the scorer and the judge check them against what they asked.
 */
export type Ask = (
  request: SystemOneRequest<Record<string, SharedQuestion>>,
  signal: AbortSignal | undefined
) => Promise<{ model: string; answers: unknown }>;

// Jev, the shortest reader, takes at most 32k tokens of state plus the longest question, and
// Chinese runs close to a token per character.
const MAX_TEXT_LENGTH = 12_000;

// Every vendor's model is asked the same questions. Jev is weak on negation, so each question and
// option says what the text does.
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
  // Measured with `scripts/eval-speakers.ts`; where it was published says as much as its words.
  speaker: choice(
    "Who wrote and published `text`, judging by what it says and by `source`, the site and address it was published at?",
    {
      [TextSpeaker.Company]:
        "The company in `listing` itself: a filing with the exchange, a press release, or a statement on its own site",
      [TextSpeaker.Outlet]:
        "A news outlet's journalists or a broker's analysts: an article, a news brief, a column or a research note",
      [TextSpeaker.Investor]:
        "An individual investor: a post or comment on a forum, a discussion board or a social network, including a news article an investor reposts there",
      [TextSpeaker.Reference]:
        "A page of data or listings that tells no story of its own: quotes, charts, financial tables, holdings, a company profile, or a list of headlines or links",
      [TextSpeaker.Other]:
        "Someone else publishing in their own name, such as a regulator, an exchange or a government body",
    }
  ),
};

// Each asks for what the command does, since Jev is weak on negation; a command is harmless only
// when every answer is unlikely.
export const COMMAND_QUESTIONS = {
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

// Asked of a strategy's code and the command that runs it; measured with `scripts/eval-code.ts`.
// Each asks for what the code does, as the command questions do; code is harmless only when every
// answer is unlikely.
const CODE_QUESTIONS = {
  files: noul(
    "Does the program in `code`, run by `command`, read, write, move or delete any file or folder other than its input file, its output file and the files beside its own code?",
    {
      true: "At least one part of it opens, lists, writes, renames or deletes a place elsewhere: the user's home, another application's folder, the temporary folder, or a path it builds from the user's name or that starts outside its own folder.",
      false:
        "Every file it touches is the input file or the output file its environment names, or a file beside its own code named from its own folder.",
    }
  ),
  network: noul(
    "Does the program in `code`, run by `command`, send or receive anything over the network?",
    {
      true: "At least one part of it contacts another computer, or this one over a socket: a web address, an HTTP client, a download, an upload, a database server, or a library function handed a URL to read.",
      false:
        "Every part of it works only with the bars in its input file and the files beside its own code.",
    }
  ),
  secrets: noul(
    "Does the program in `code`, run by `command`, read passwords, keys, tokens, credentials, environment variables besides SOLYX_STRATEGY_INPUT and SOLYX_STRATEGY_OUTPUT, or another application's private data?",
    {
      true: "At least one part of it reads the whole environment or a variable other than those two, SSH or cloud credentials, .env files, the keychain, a browser's data, or an application's support folder or database.",
      false:
        "From its environment it reads only SOLYX_STRATEGY_INPUT and SOLYX_STRATEGY_OUTPUT, and from the files only its input and its own.",
    }
  ),
  runs: noul(
    "Does the program in `code`, run by `command`, start another program or a shell, or run code it builds from text or data as it runs?",
    {
      true: "At least one part of it starts a process or a shell, or runs code its own text does not show: eval, exec, compile, a module imported by a name made at run time, decoded or downloaded code, native code it loads, or a function looked up by a name built from strings.",
      false:
        "Every part of it is code its own text shows, calling the language and its libraries by name, and `command` only starts that code.",
    }
  ),
};

// Asked of a claim and the quote it rests on; measured with `scripts/eval-claims.ts`.
const CLAIM_QUESTIONS = {
  supported: noul(
    "Does `quote`, words or figures taken from a source, state what `claim` asserts? Either may be in Chinese or English, and a figure may be rounded or written in another unit.",
    {
      true: "The quote states the claim's facts, or gives the figures the claim follows from directly.",
      false:
        "The quote is about something else, gives figures that differ from the claim's, or says less than the claim asserts.",
    }
  ),
};

// Asked of each fact a forecast rests on, alone; measured with `scripts/eval-facts.ts`. Each level
// names what a fact of its kind states, since a fact is a figure or an event rather than a story.
const FACT_QUESTIONS = {
  stance: score(
    "How does what `fact` states bear on the share price of the company it is about over the coming weeks? `quote` gives the source's own words or figures for it. Either may be in Chinese or English.",
    [
      "Clearly bad for the share price: sales, profit or cash falling hard, an outlook cut, heavy selling by large investors, or the price breaking below a level it had held",
      "Somewhat bad: a weaker figure, debt or cash needs growing, some selling by large investors, or the price below its moving averages",
      "Mixed or neutral: only a date, a price level, a schedule or a description, or figures that point both ways",
      "Somewhat good: a firmer figure, some buying by large investors, or the price above its moving averages",
      "Clearly good for the share price: sales, profit or cash rising strongly, an outlook raised, heavy buying by large investors, or the price breaking above a level that had capped it",
    ]
  ),
};

const noulSchema = z.object({ noul: z.number() });

const claimAnswersSchema = z.object({ supported: noulSchema });

// A score's probabilities are keyed by the level's index, from clearly bad to clearly good.
const stanceSchema = z
  .object({
    probabilities: z.object({
      0: z.number(),
      1: z.number(),
      2: z.number(),
      3: z.number(),
      4: z.number(),
    }),
  })
  .transform(({ probabilities: levels }): Record<Stance, number> => ({
    [Stance.Negative]: levels[0],
    [Stance.LeanNegative]: levels[1],
    [Stance.Neutral]: levels[2],
    [Stance.LeanPositive]: levels[3],
    [Stance.Positive]: levels[4],
  }));

const factAnswersSchema = z.object({ stance: stanceSchema });

const answersSchema = z.object({
  relevance: noulSchema,
  stance: stanceSchema,
  kind: z.object({ probabilities: z.record(z.enum(TextKind), z.number()) }),
  topic: z.object({ probabilities: z.record(z.enum(TextTopic), z.number()) }),
  speaker: z.object({
    probabilities: z.record(z.enum(TextSpeaker), z.number()),
  }),
});

const commandAnswersSchema = z.object({
  changes: noulSchema,
  network: noulSchema,
  secrets: noulSchema,
  runs: noulSchema,
  privileged: noulSchema,
});

/** One question per risk, which a vendor rewords where its model reads the shared wording badly. */
export type CommandQuestions = Record<
  keyof typeof COMMAND_QUESTIONS,
  NoulQuestion
>;

/** Judges shell commands with the model `ask` reaches. */
export function createCommandJudge(
  ask: Ask,
  questions: CommandQuestions = COMMAND_QUESTIONS
): CommandJudge {
  return {
    async judge(input, { signal } = {}): Promise<CommandJudgement> {
      // What a cut command leaves out would still run, so a command is judged whole or not at all.
      if (input.command.length > MAX_TEXT_LENGTH) {
        throw new Error(
          `The decisions model reads commands of up to ${MAX_TEXT_LENGTH} characters, and this one has ${input.command.length}`
        );
      }

      const { model, answers: unread } = await ask(
        {
          state: { shell: input.shell, command: input.command },
          questions,
        },
        signal
      );

      const answers = commandAnswersSchema.parse(unread);

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

const codeAnswersSchema = z.object({
  files: noulSchema,
  network: noulSchema,
  secrets: noulSchema,
  runs: noulSchema,
});

/** A strategy's files as the model reads them, each under a line naming its path. */
const codeText = (files: readonly { path: string; text: string }[]) =>
  files.map((file) => `--- ${file.path} ---\n${file.text}`).join("\n");

/** Judges strategies' code with the model `ask` reaches. */
export function createCodeJudge(ask: Ask): CodeJudge {
  return {
    async judge(input, { signal } = {}): Promise<CodeJudgement> {
      const code = codeText(input.files);
      const length = input.command.length + code.length;

      // What a cut leaves out would still run, so code is judged whole or not at all.
      if (length > MAX_TEXT_LENGTH) {
        throw new Error(
          `The decisions model reads code of up to ${MAX_TEXT_LENGTH} characters, and this has ${length}`
        );
      }

      const { model, answers: unread } = await ask(
        { state: { command: input.command, code }, questions: CODE_QUESTIONS },
        signal
      );

      const answers = codeAnswersSchema.parse(unread);

      return {
        model,
        files: answers.files.noul,
        network: answers.network.noul,
        secrets: answers.secrets.noul,
        runs: answers.runs.noul,
      };
    },
  };
}

/** Reads claims against their quotes with the model `ask` reaches. */
export function createClaimAuditor(ask: Ask): ClaimAuditor {
  return {
    async audit(claim, { signal } = {}) {
      const { model, answers: unread } = await ask(
        {
          state: { claim: claim.text, quote: claim.quote },
          questions: CLAIM_QUESTIONS,
        },
        signal
      );

      return {
        model,
        supported: claimAnswersSchema.parse(unread).supported.noul,
      };
    },
  };
}

/** Reads how a fact bears on its company's share price with the model `ask` reaches. */
export function createFactReader(ask: Ask): FactReader {
  return {
    async read(claim, { signal } = {}) {
      const { model, answers: unread } = await ask(
        {
          state: { fact: claim.text, quote: claim.quote },
          questions: FACT_QUESTIONS,
        },
        signal
      );

      return { model, stance: factAnswersSchema.parse(unread).stance };
    },
  };
}

/** Scores texts with the model `ask` reaches. */
export function createScorer(ask: Ask): SentimentScorer {
  return {
    async score(
      input: SentimentInput,
      { signal }: { signal?: AbortSignal } = {}
    ): Promise<SentimentScore> {
      const { model, answers: unread } = await ask(
        {
          state: {
            listing: {
              market: input.symbol.market,
              code: input.symbol.symbol,
              name: input.listing?.name ?? null,
              englishName: input.listing?.englishName ?? null,
            },
            title: input.title ?? null,
            text: input.text.slice(0, MAX_TEXT_LENGTH),
            source: { site: input.site, url: input.url },
          },
          questions: QUESTIONS,
        },
        signal
      );

      const answers = answersSchema.parse(unread);

      return {
        model,
        relevance: answers.relevance.noul,
        stance: answers.stance,
        kind: answers.kind.probabilities,
        topic: answers.topic.probabilities,
        speaker: answers.speaker.probabilities,
      };
    },
  };
}
