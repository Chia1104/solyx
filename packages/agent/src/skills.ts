import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { uniqBy } from "es-toolkit";
import { parse } from "yaml";
import * as z from "zod";

import { errorMessage, isErrnoError } from "@solyx/utils/error";

import { SkillSource } from "./skill-source.ts";

/** A playbook the agent reads with `read_skill` before a task it covers. */
export interface AgentSkill {
  name: string;
  /** Shown in the system prompt's catalog; says when the skill applies. */
  description: string;
  body: string;
  source: SkillSource;
  /** The user may ask for it by starting a message with `/name`; background knowledge is not asked for. */
  userInvocable: boolean;
  /** Where its files are, such as the scripts its playbook names; a built-in has none. */
  folder?: string;
}

const lines = (...text: string[]) => text.join("\n");

const BUILT_IN_SKILLS: readonly AgentSkill[] = [
  {
    name: "order-proposal",
    source: SkillSource.BuiltIn,
    userInvocable: true,
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
    userInvocable: true,
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
    userInvocable: false,
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
      "- Taiwan quotes rising prices in red and falling prices in green, the opposite of the US.",
      "- get_flows says who traded after each session. Read the week and the month and the runs, not one session: foreign flows carry ETF and index arbitrage, and dealer hedging follows the warrants dealers issued. Margin purchases rising while the price falls are holders who may be forced to sell."
    ),
  },
  {
    name: "us-market",
    source: SkillSource.BuiltIn,
    userInvocable: false,
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
      "- Earnings and major data releases often gap the price outside any stop. get_calendar has no US dates yet, so check the web, with sources, before proposing across one."
    ),
  },
  {
    name: "portfolio-review",
    source: SkillSource.BuiltIn,
    userInvocable: true,
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
  {
    name: "deep-analysis",
    source: SkillSource.BuiltIn,
    userInvocable: true,
    description:
      "A deep analysis of one listing: bringing its research report up to date, then one forecast for the coming sessions that the app scores. Read when the user asks for a deep analysis, a research report, a forecast or a prediction of a listing.",
    body: lines(
      "# Deep analysis",
      "",
      "A deep analysis leaves two things in the app: the listing's report, your view over quarters, and one forecast for the coming sessions, which is frozen once made and scored against what the price then does. Work in this order.",
      "",
      "1. Call get_research. Read the report and how old each part is, the latest forecasts with how they came out, your record, any news read as stating a falsifier, and any event marked as passed. Where a forecast missed, say what you misread; where news may have met a falsifier, read the item and say whether it did; where an event has passed, find what came of it, before going on.",
      "2. Gather evidence, keeping the as_of time of every number: get_candles and get_indicators on 1d and 1w, following technical-read; get_news over 30 days; get_fundamentals for the filed quarters, the monthly revenue, the distributions and what the shares trade at against their earnings; get_calendar for the dates ahead; get_flows, for a Taiwan listing, for who has been buying and selling it and the market; web_search and read_page, when you have them, for guidance and what the numbers do not say. Compute with run_analysis.",
      "3. Call revise_report when the listing has no report, or when what you found changes it. Send only the parts that changed; the rest stays.",
      "   - A driver or a risk has two parts. point is your reading: why it matters to the thesis, and it may infer, weigh or look ahead. text is the fact it rests on and says no more than its quote: no cause, forecast, comparison or caveat the quote does not give. quote is the source's own words or figures, and source says where. Where the user set up a decisions model, it reads text against quote and the call is refused when text says more, so put every judgement in point. Leave out what you cannot source.",
      "   - Quote in full. Give the whole sentence, or every row of a table the fact uses, and never shorten a quote with an ellipsis: what you cut is what the fact is checked against. A fact that sums up many rows, such as a range or a low, quotes every row it covers or the line where a tool worked it out; otherwise state only the rows you quote. One fact to a claim: a second fact needs its own quote.",
      '   - A falsifier says what would show the thesis wrong, as something that happens: "monthly revenue falls year on year two months running".',
      "   - Give a valuation range only from figures you hold: the trailing EPS and the multiples the shares have traded at, both from get_fundamentals. Name them in its basis, and leave the range out when there are no earnings to stand on.",
      "   - Events are the dates ahead that could move the shares and that get_calendar does not already list: an earnings call, a shareholders' meeting, a launch, a ruling, a policy decision. The app's calendar shows them beside its own dates, so each needs the source's own words that give the day, and its timing: set, deadline or expected. Leave out what get_calendar already has, such as a filing deadline or an ex-dividend day.",
      "   - An event whose day has passed is no longer ahead. Send events again without it, and put what came of it where it bears on the thesis: the catalysts section, a driver or a risk.",
      "   - The sections hold what stays true for quarters: the business, the financials, the valuation, the catalysts and the risks. A chart read goes stale within days, so it belongs in the forecast's rationale, never in the report.",
      "4. Call submit_forecast, once per session of the listing.",
      "   - The horizon is how many sessions ahead the forecast looks, at most 20. Look 5 to 10 ahead unless the user asks for another span; a forecast of one or two sessions says little. An event inside the horizon is no reason to shorten it: name it in the rationale and give the outer bands more of the probability for it.",
      "   - Two to four scenarios, each a band the horizon's close lands in. Together the bands hold every price once: the lowest has no low, the highest no high, and each band's high is the next band's low. Set the edges at levels the bars show.",
      "   - Before you set the probabilities, call search_history with kinds forecast and the words of your main argument, across every listing. How forecasts argued alike came out is evidence for the numbers you give; where one argued alike missed, say what differs now or give that scenario more.",
      "   - Probabilities are whole percents adding to 100. Your record shows how often the numbers you gave held; lean towards what it shows, and keep a scenario you find unlikely above zero.",
      "   - Each scenario's path gives the closes you expect on the way, by session counted from the newest daily bar, and ends at the horizon inside its band.",
      "   - Long or short carries a plan: entry, stop and target on the tick grid, the stop beyond a level the bars show, the target paying at least what the stop risks and 1.5 times it before you would ever propose it. Neutral has no plan.",
      "   - claims are the facts the rationale rests on, each saying no more than its quote, as in the report. What you make of them goes in the rationale.",
      "   - When the direction goes against the report's stance, give the reason in contrary.",
      "5. When a call is refused, fix what it names and call again.",
      "6. Tell the user the stance and thesis in two sentences, the scenarios with their probabilities, the plan, and what would change your mind. Say the forecast is scored once its horizon closes. You may draw the scenarios' bands and paths as a view, following views.",
      "",
      "A deep analysis ends at the forecast. Propose an order only when the user asks for one, following order-proposal."
    ),
  },
  {
    name: "views",
    source: SkillSource.BuiltIn,
    userInvocable: false,
    description:
      "Drawing a view in a reply: a chart, a comparison or a layout written as an html code block, which the app draws in place of the code. Read before drawing one, when a picture says more than prose or a table, such as a forecast's bands and paths or listings side by side.",
    body: lines(
      "# Views",
      "",
      "A fenced code block whose language is html is drawn in the reply as a view instead of shown as code. The app draws it once the fence closes; until then the user sees a placeholder.",
      "",
      "- Draw only with HTML, CSS and inline SVG. Scripts do not run and nothing loads: no images, fonts, stylesheets or frames from anywhere. Put every style in a <style> element or a style attribute.",
      "- Every number in a view comes from a tool in this conversation, as in prose. The view adds to the reply and never replaces it: the text still gives the answer, the evidence and its as_of times.",
      "- Colour with the app's custom properties, so the view follows the user's theme: --background, --foreground, --surface, --surface-secondary, --muted, --separator, --border, --accent, --accent-foreground and --radius. Leave the page's background transparent.",
      "- Red and green mean price direction and nothing else. A rise is var(--tw-rise) or var(--us-rise) and a fall var(--tw-fall) or var(--us-fall), for the listing's market; they follow which colour the user has rise. Never write a red or green of your own.",
      "- The view is as wide as the reply, often under 480px, and as tall as what it holds. Size with percentages, flex or grid, give an svg a viewBox and width 100%, and never set a fixed width wider than that.",
      "- Write its labels in the reply's language. A link in a view opens in the browser only after the user confirms it, as in the reply.",
      "- One view to an idea, kept short. A plain table stays a markdown table."
    ),
  },
  {
    name: "solyx-guide",
    source: SkillSource.BuiltIn,
    userInvocable: true,
    description:
      "Using and setting up Solyx itself: first-time setup, what each setting does, keys and sign-ins, approval modes, skills, memory, MCP servers and why a feature does not work. Read when the user asks how to use or set up the app, or something in it does not work.",
    body: lines(
      "# Solyx guide",
      "",
      "Read get_setup before you answer: it says what is set up and what is missing, tab by tab, with each tab's link. Answer from it rather than from this guide's general account, and link the tab the user acts on.",
      "",
      "## What Solyx is",
      "- A desktop app for trading Taiwan (TWSE, TPEx) and US stocks. You research and may propose an order; the user confirms or dismisses it in the app, and only then does it reach the broker. The account is paper, with no real money, until the user turns a live broker on.",
      "- Everything runs on the user's computer on their own keys. The app runs no server between them and their providers.",
      "",
      "## First-time setup, in the order the app's own setup takes",
      "1. Market data, for Taiwan's charts, quotes and news: a Fugle API key, or Fubon. Fubon needs its SDK, which the user downloads from Fubon and the app loads from the folder they pick, the certificate exported from Fubon's website, their ID number and API key. A failed Fubon sign-in is not tried again on its own, since repeated failures could lock the account: the user fixes the settings or signs in again on the tab.",
      "2. The agent's model: a provider switched on with its API key saved, or OpenAI signed in with ChatGPT. The default model, its thinking and who decides forecasts and proposals (the agent alone, or the MAGI's three units, at three more requests each time) are on the same tab.",
      "3. Web search: a Firecrawl, Exa or Tavily key. Without one you have no web_search or read_page, and news searches only its sources that need no key.",
      "4. A decisions model (TypeSafe, Cloudflare Workers AI or OpenAI) scores news, checks the claims in research against their quotes, and judges shell commands for the auto approval mode. Without one, news goes unscored and auto asks about every command.",
      "- Optional: a FinMind token raises its request limit, and a paid plan adds the trading restrictions only members read; fundamentals and investor flows work without one. Embeddings, experimental, group news by meaning.",
      "",
      "## Keys, tokens and sign-ins",
      "- The user enters them on the tab, never in the conversation: the app keeps them encrypted in the computer's secret store and never shows them again, while whatever is written in a conversation is kept with it and sent to the model's provider. Where the computer has no secret store, nothing can be saved.",
      "- If the user pastes one, do not repeat it. Tell them it is now in the conversation and was sent to the model's provider, and that they should revoke it with whoever issued it and save a new one on the tab.",
      "",
      "## Conversations",
      "- Each conversation has an approval mode the user sets in the composer: ask, where calls that need it wait for them; auto, where a shell command the decisions model judges harmless runs and a page your searches found is read; and bypass, where they all run unasked. Order proposals always wait for the user to confirm, whatever the mode.",
      "- A conversation may pick its own model and thinking; otherwise it runs on the default.",
      "- The user may start a message with /name to ask for a skill, and write @ before a code to name a listing they have on screen, hold or watch. The composer suggests both as they type, and the Skills tab shows each skill that can be asked for as /name.",
      "",
      "## Files the user writes for you",
      "- The config folder (get_setup gives its path) holds config.json, every setting as JSON with config.schema.json documenting each entry; a saved edit applies without a restart. Beside it: skills/<name>/SKILL.md for their own playbooks, which replace a built-in of the same name, and which user-invocable: false in the frontmatter keeps from being asked for with /name; AGENTS.md for standing instructions sent with every message; mcp.json for MCP servers.",
      "- Skills in ~/.agents/skills are offered only once the user switches each on, on the Skills tab.",
      "- MCP servers: each tool is off, asks first, or runs on its own, which only a tool its server marks read-only may. A secret an entry names as secret:NAME is entered on the MCP tab, and a remote server may need the user to sign in there.",
      "",
      "## The rest",
      "- The shell is off until the user switches it on, and stays off while the account is live; each command waits for them unless the approval mode lets it run.",
      "- Memory: you save, rewrite or forget a memory only once the user allows it; they read and edit them on the Memory tab, or switch memory off there.",
      "- Updates: the app checks every six hours while that setting is on. Windows installs on restart; on macOS the update is linked for the user to download.",
      "",
      "## Changing settings",
      "- change_setting changes a setting get_setup says it takes, such as the theme, the default model and thinking, who decides forecasts and proposals, data sources and plans, news collection and the vendors in use. Use it when the user asks for that change or agrees to one you suggested, and say what the change does first. The user allows each change unless the conversation's approval mode lets it run, and it applies at once.",
      "- Keys, sign-ins, the providers switched on, endpoints, the shell, MCP tools, shared skills and memory only the user changes: walk them to the tab with its link and say what to pick."
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

// The Agent Skills format's limits.
const MAX_NAME_LENGTH = 64;

const MAX_DESCRIPTION_LENGTH = 1024;

const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const frontmatterSchema = z.looseObject({
  name: z.string().optional(),
  description: z.string().optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
});

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

interface SkillProblem {
  /** The skill's folder name, which `agent.sharedSkills` switches on. */
  folder: string;
  path: string;
  message: string;
}

/**
 * Every `<folder>/<name>/SKILL.md` under `root`. A skill without a description is left out, and
 * one hidden with `disable-model-invocation` too; other breaks of the format are reported but
 * keep the skill. `user-invocable: false` keeps it from being asked for with `/name`, as other
 * agents read it.
 */
async function readSkillFolder(root: string, source: SkillSource) {
  const skills: AgentSkill[] = [];
  const problems: SkillProblem[] = [];

  let names: string[];

  try {
    names = await readdir(root);
  } catch (error) {
    // A folder the user never made has no skills to report on.
    if (!isErrnoError(error, "ENOENT")) {
      problems.push({ folder: "", path: root, message: errorMessage(error) });
    }

    return { skills, problems };
  }

  for (const folder of names.toSorted()) {
    if (folder.startsWith(".") || folder === "node_modules") continue;

    const path = join(root, folder, "SKILL.md");

    const report = (message: string) =>
      problems.push({ folder, path, message });

    let text: string;

    try {
      // Followed through links, since shared skills are often linked into place.
      if (!(await stat(join(root, folder))).isDirectory()) continue;

      text = await readFile(path, "utf8");
    } catch (error) {
      // A folder without SKILL.md holds no skill.
      if (!isErrnoError(error, "ENOENT")) report(errorMessage(error));

      continue;
    }

    const normalized = text.replace(/\r\n?/g, "\n");
    const match = FRONTMATTER.exec(normalized);

    let metadata: z.infer<typeof frontmatterSchema>;

    try {
      const parsed = frontmatterSchema.safeParse(
        match ? (parse(match[1]) ?? {}) : {}
      );

      if (!parsed.success) {
        report(z.prettifyError(parsed.error));

        continue;
      }

      metadata = parsed.data;
    } catch (error) {
      report(errorMessage(error));

      continue;
    }

    const name = metadata.name || folder;
    const description = metadata.description?.trim();

    if (name !== folder) {
      report(`name "${name}" does not match its folder "${folder}"`);
    }

    if (name.length > MAX_NAME_LENGTH || !SKILL_NAME.test(name)) {
      report(
        `name "${name}" must be up to ${MAX_NAME_LENGTH} lowercase letters, digits and single hyphens`
      );
    }

    if (!description) {
      report("description is required");

      continue;
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      report(
        `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`
      );
    }

    if (metadata["disable-model-invocation"] === true) continue;

    skills.push({
      name,
      description,
      body: normalized.slice(match?.[0].length ?? 0).trim(),
      source,
      userInvocable: metadata["user-invocable"] !== false,
      folder: join(root, folder),
    });
  }

  return { skills, problems };
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
  const [own, shared] = await Promise.all([
    readSkillFolder(folders.solyx, SkillSource.Solyx),
    readSkillFolder(folders.shared, SkillSource.Shared),
  ]);

  return {
    skills: uniqBy(
      [...own.skills, ...BUILT_IN_SKILLS, ...shared.skills],
      (skill) => skill.name
    ).map((skill) => ({
      ...skill,
      offered:
        skill.source !== SkillSource.Shared || sharedEnabled.has(skill.name),
    })),
    // A shared skill left off is other agents' business, so its problems are not reported here.
    warnings: [
      ...own.problems,
      ...shared.problems.filter((problem) => sharedEnabled.has(problem.folder)),
    ].map((problem) => `${problem.path}: ${problem.message}`),
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
    if (isErrnoError(error, "ENOENT")) return undefined;

    throw error;
  }

  return text || undefined;
}
