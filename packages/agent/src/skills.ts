import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  BACKGROUND_CONTEXT,
  loadSourcedSkills,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

/** Where a skill comes from, which decides whether it is offered and which one wins a name. */
export const SkillSource = {
  /** `skills/` in the app's config folder: the user's own, always offered, ahead of built-ins. */
  Solyx: "solyx",
  BuiltIn: "built-in",
  /** `~/.agents/skills`, shared with other agents: offered only once the user switches one on. */
  Shared: "shared",
} as const;

export type SkillSource = (typeof SkillSource)[keyof typeof SkillSource];

/** A playbook the agent reads with `read_skill` before a task it covers. */
export interface AgentSkill {
  name: string;
  /** Shown in the system prompt's catalog; says when the skill applies. */
  description: string;
  body: string;
  source: SkillSource;
}

const lines = (...text: string[]) => text.join("\n");

const BUILT_IN_SKILLS: readonly AgentSkill[] = [
  {
    name: "order-proposal",
    source: SkillSource.BuiltIn,
    description:
      "Turning a trade idea into an order proposal: entry, invalidation, size and the rationale the user reviews. Read before calling check_order or propose_order.",
    body: lines(
      "# Order proposal",
      "",
      "1. State the thesis in one sentence and the timeframe it lives on.",
      "2. Pull fresh data with get_candles and get_indicators for that timeframe and one above it. Quote the as_of time of every number you use.",
      "3. Pick the invalidation: the price at which the thesis is wrong, placed beyond a level the data shows (a swing low, a moving average, a range edge), not a round percentage.",
      "4. Pick the first target from the data as well, and compute reward-to-risk as (target - entry) / (entry - invalidation) for a buy, mirrored for a sell. Below 1.5, do not propose; say why instead.",
      "5. Size from risk. Read get_account. Unless the user set a different budget, risk at most 1% of the account's equity in that currency between entry and invalidation, then round down to a valid quantity for the market. Never size beyond the cash available.",
      "6. Prefer limit orders on the market's tick grid. Run check_order and fix every violation it reports before proposing.",
      "7. Call propose_order once. The rationale must hold: the thesis, the evidence with its as_of times, entry, invalidation, target, reward-to-risk, and what would make you withdraw the idea.",
      "8. Tell the user the proposal is waiting for their confirmation in the app. Never say an order was placed.",
      "",
      "Do not propose when data is missing or stale, when the market is closed and the user did not ask for a resting order, or when the user only asked for an opinion."
    ),
  },
  {
    name: "technical-read",
    source: SkillSource.BuiltIn,
    description:
      "Reading a chart across timeframes with the indicators the app computes (MA, EMA, RSI, MACD, KD, Bollinger Bands). Read before giving a view on trend, momentum or levels.",
    body: lines(
      "# Technical read",
      "",
      "- Start one timeframe above the one asked about to find the trend, then read the asked one for timing.",
      "- Trend: price against the 20 and 60 period averages, and whether those averages rise or fall. Higher highs and higher lows, or the reverse, decide the trend before any oscillator does.",
      "- Momentum: RSI above 70 or below 30 describes strength, not a reversal signal on its own. MACD (DIF, MACD, OSC in Taiwan terms) and KD crosses matter more when they agree with the trend.",
      "- Volatility: Bollinger Band width shows compression before expansion; a close outside the band in a trend is continuation more often than exhaustion.",
      "- Levels: name the highs, lows and ranges the bars show, with their dates.",
      "- Volume confirms a breakout when it expands on the move.",
      "- Give scenarios, each with the condition that confirms it, instead of one price target.",
      "- Say what the indicators cannot tell: news, earnings, liquidity and gaps are outside them."
    ),
  },
  {
    name: "taiwan-market",
    source: SkillSource.BuiltIn,
    description:
      "Taiwan (TWSE and TPEx) trading rules: sessions, board and odd lots, tick sizes, price limits, costs and settlement. Read before sizing or pricing a Taiwan order.",
    body: lines(
      "# Taiwan market",
      "",
      "- Sessions in Taipei time: orders from 08:30, continuous trading 09:00 to 13:25 and a closing auction to 13:30, after-hours fixed-price trading 14:00 to 14:30. get_market_status gives the live state.",
      "- A board lot is 1,000 shares. One order is either whole board lots or an odd lot of 1 to 999 shares, which trades in its own book. Market orders are not accepted for odd lots.",
      "- Quantities are always in shares: 2 lots is 2000.",
      "- Stock ticks: 0.01 below 10, 0.05 below 50, 0.1 below 100, 0.5 below 500, 1 below 1,000, then 5. ETF ticks: 0.01 below 50, then 0.05.",
      "- Prices move at most 10% from the previous close in a day; some ETFs have no limit.",
      "- Costs: brokers charge up to 0.1425% commission on each side, and selling pays securities transaction tax (0.3% for stocks, lower for ETFs and day trades). Include them when the edge is small.",
      "- Settlement is T+2; cash must be in the account by then.",
      "- Taiwan quotes rising prices in red and falling prices in green, the opposite of the US."
    ),
  },
  {
    name: "us-market",
    source: SkillSource.BuiltIn,
    description:
      "US equity trading rules: regular and extended hours, ticks, halts, settlement and day-trading limits. Read before sizing or pricing a US order.",
    body: lines(
      "# US market",
      "",
      "- Sessions in New York time: pre-market 04:00 to 09:30, regular 09:30 to 16:00, after-hours 16:00 to 20:00. Extended hours are thinner and usually accept limit orders only. get_market_status gives the live state.",
      "- Whole shares only in this app.",
      "- Ticks are $0.01 at $1 and above, $0.0001 below.",
      "- There is no daily price limit, but limit-up/limit-down bands pause single stocks and market-wide circuit breakers halt trading on large index drops.",
      "- Settlement is T+1.",
      "- Margin accounts under $25,000 may be restricted by the pattern day trader rule; the broker decides. Paper trading is not affected.",
      "- Earnings and major data releases often gap the price outside any stop; check the calendar the user gives you before proposing across one."
    ),
  },
  {
    name: "portfolio-review",
    source: SkillSource.BuiltIn,
    description:
      "Reviewing the account: exposure, concentration, positions without a plan, and cash per currency. Read when the user asks how their account or positions look.",
    body: lines(
      "# Portfolio review",
      "",
      "1. Read get_account and list_proposals.",
      "2. For each position, compare its average price with the latest close from get_candles and state the open gain or loss in its currency.",
      "3. Flag concentration: any position above 20% of the account's value in its currency, or several positions that move together.",
      "4. Flag positions with no invalidation the user has stated, and ask for one rather than inventing it.",
      "5. Report cash per currency and what pending proposals would use.",
      "6. Suggest at most one change, and only as a proposal the user confirms, following order-proposal."
    ),
  },
];

export interface SkillFolders {
  /** `skills/` in the app's config folder. */
  solyx: string;
  /** `~/.agents/skills`. */
  shared: string;
}

export interface SkillCatalog {
  /** Every skill found, the user's own first, each name once. */
  skills: (AgentSkill & { offered: boolean })[];
  /**
   * Problems in the user's own skill files and in shared skills they switched on; a skill whose
   * metadata breaks the Agent Skills format is still offered when it has a description.
   */
  warnings: string[];
}

/**
 * The skills the agent may be offered: the user's own in the config folder, then the built-ins,
 * then shared skills the user switched on in `sharedEnabled`. A name taken by an earlier source
 * hides later ones, so a shared skill never replaces a trading playbook. Skills marked
 * `disable-model-invocation` are left out.
 */
export async function loadSkillCatalog(
  folders: SkillFolders,
  sharedEnabled: ReadonlySet<string>
): Promise<SkillCatalog> {
  const { skills: found, diagnostics } = await loadSourcedSkills(
    new NodeExecutionEnv({ cwd: folders.solyx }),
    [
      { path: folders.solyx, source: SkillSource.Solyx },
      { path: folders.shared, source: SkillSource.Shared },
    ],
    undefined,
    BACKGROUND_CONTEXT
  );

  const loaded = found
    .filter(({ skill }) => !skill.disableModelInvocation)
    .map(({ skill, source }) => ({
      name: skill.name,
      description: skill.description,
      body: skill.content,
      source,
    }));

  const byName = new Map<string, AgentSkill & { offered: boolean }>();

  const add = (skill: AgentSkill, offered: boolean) => {
    if (!byName.has(skill.name)) byName.set(skill.name, { ...skill, offered });
  };

  for (const skill of loaded) {
    if (skill.source === SkillSource.Solyx) add(skill, true);
  }

  for (const skill of BUILT_IN_SKILLS) add(skill, true);

  for (const skill of loaded) {
    if (skill.source === SkillSource.Shared) {
      add(skill, sharedEnabled.has(skill.name));
    }
  }

  return {
    skills: [...byName.values()],
    // A shared skill left off is other agents' business, so its problems are not reported here.
    warnings: diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.source === SkillSource.Solyx ||
          sharedEnabled.has(basename(dirname(diagnostic.path)))
      )
      .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`),
  };
}

/**
 * The user's standing instructions from `AGENTS.md` in the app's config folder, or `undefined`
 * while there is none. Sent whole with every request; the settings page shows how long it is.
 */
export async function loadInstructions(
  file: string
): Promise<string | undefined> {
  let text: string;

  try {
    text = (await readFile(file, "utf8")).trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  return text || undefined;
}
