import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { uniqBy } from "es-toolkit";
import { parse } from "yaml";
import * as z from "zod";

import { errorMessage, isErrnoError } from "@solyx/utils/error";
import { readTextIfExists } from "@solyx/utils/server";

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
      "2. Pull fresh data with get_candles and get_indicators for that timeframe and one above it. Quote the as_of time of every number you use. For a fund, also read its premium or discount in get_fundamentals, and check it as fund-research says before proposing to buy.",
      "3. Pick the invalidation: the price at which the thesis is wrong, placed beyond a level the data shows (a swing low, a moving average, a range edge), not a round percentage.",
      "4. Pick the first target from the data as well, and compute reward-to-risk as (target - entry) / (entry - invalidation) for a buy, mirrored for a sell. Below 1.5, do not propose; say why instead.",
      "5. Size from risk. Read get_account. Unless the user set a different budget, risk at most 1% of the account's equity in that currency between entry and invalidation, then round down to a valid quantity for the market. Never size beyond the cash available.",
      "6. Prefer limit orders on the market's tick grid. Run check_order and fix every violation it reports before proposing.",
      "7. Call propose_order once. The rationale must hold: the thesis, the evidence with its as_of times, entry, invalidation, target, reward-to-risk, and what would make you withdraw the idea.",
      "8. Tell the user what propose_order answered: the proposal waits for their confirmation in the app, or their trading mandate covered it and the app sent it to the broker. Never say an order filled.",
      "",
      "Do not propose when data is missing or stale, when the market is closed and the user did not ask for a resting order, or when the user only asked for an opinion.",
      "",
      "Once a buy has filled, offer to protect it with an exit at its invalidation and target, as exit-plan says."
    ),
  },
  {
    name: "exit-plan",
    source: SkillSource.BuiltIn,
    userInvocable: true,
    description:
      "Setting a stop, a target or both on a position the account holds, which the broker watches and sells at itself. Read before calling propose_exit.",
    body: lines(
      "# Exit plan",
      "",
      "1. Read get_account: the position, and the exits the broker already watches. Sell only shares no working sale or other exit sells.",
      "2. Read get_research for the listing. The stop is where the thesis is wrong: a price one of the report's falsifiers names, or the invalidation the buy was proposed with, placed beyond a level the data shows (a swing low, a moving average, a range edge). Where no level is near, use a multiple of the average true range from get_indicators. Never a round percentage.",
      "3. The target comes from the forecast's bands or the order's first target. Either price may be left out, but say what that leaves unprotected.",
      "4. Read get_base_rates over the horizon you mean to watch, and say how often the listing's past moves reached the stop and the target from here.",
      "5. Watch until the forecast's horizon or the day the thesis should have played out by, from tomorrow to 60 days on. Put both prices on the market's tick grid, the stop below the last price and the target above it.",
      "6. Call propose_exit once. The rationale holds why each price, the evidence with its as_of times and what the exit protects.",
      "7. Tell the user what it means: once they confirm it, the broker watches the price even while the app is closed; the stop sells at the day's lower limit, so it fills at what buyers bid and can fill well below the stop on a gap; the target sells at its price. Once one sells, the app cancels the other when it next runs, so while it is closed both could sell if the account holds more shares than the exit sells. On a paper account the price is checked only while the app runs.",
      "",
      "Never call an exit placed, sold or filled unless a tool says so. An exit that ended reads as ended in list_proposals; whether it sold is in the account's fills."
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
    name: "backtest",
    source: SkillSource.BuiltIn,
    userInvocable: true,
    description:
      "Testing a trading rule on a listing's past bars with the app's own engine: how to put the rule, split the bars and report what came of it without overselling it.",
    body: lines(
      "# Backtest",
      "",
      "1. Put the rule in words first: what buys, what sells, on which bars. Then write it as backtest.rules' Strategy in a run_analysis script, naming the listing and the interval: the engine reads the bars itself, daily unless you name another. Pass since to reach back years on daily bars, or up to three on intraday ones, for a few listings a script.",
      "2. backtest.rules tests long-only rules: it buys with the account's cash and sells all it holds. A strategy it cannot express, such as a short, borrowed money or a hedge, is not tested: say so, and offer the nearest rule it can test, named as that. Never work out a strategy's fills or returns with a script's own arithmetic, not even as an estimate.",
      "3. Always pass split, a day about two thirds of the way through the bars. Fit on the in-sample stretch alone, then read the out-of-sample one: a rule that only works before the split is fitted to noise.",
      "4. Keep the costs the engine defaults to unless the user's own broker charges less; say which you used. Taiwan's tax on sales and the commission both ways take most of a short-term edge, and an intraday rule pays them on every trade it makes.",
      "5. Report each stretch's total and yearly return, Sharpe ratio, deepest drawdown, trades, win rate, payoff ratio and time in the market, beside buying and holding's return and deepest drawdown over the same bars, so what a rule gave up and what it spared read together. Cite each figure as the engine returned it for that stretch: a stretch's trades are the ones it closed, and a position still held at the last bar is in none. A range, a rank or a count across backtests is worked out in the script and printed, never read off by eye.",
      "6. A stretch that closed fewer than twenty trades says little, and so does the best of a search among such stretches: say so wherever you report one, and draw no conclusion about the rule from it.",
      "7. A stretch's pValue says whether the rules' timing beat its bars in a random order. Report it beside the returns, and call the timing an edge only where the out-of-sample pValue is below 0.05. It says nothing of whether holding the listing paid, which buyAndHold does.",
      "8. Try variants in one backtest.scan, not one backtest.rules after another, and say how many you tried: trying many and reporting the best is fitting too, however the split reads. For two parameters, lay the strategies out as a grid with columns and report its plateau, not its best cell, and say so when the plateau lies on the grid's edge.",
      "9. To see whether picking on the past works, walk the same grid forward with backtest.walkForward and report its outOfSample beside buying and holding, what each window picked and its efficiency. Its picks change from window to window, so offer none of them as the parameters to use; the scan's plateau is the candidate, and the walk forward is how far to trust picking one.",
      "10. The engine makes up for splits and what went ex from the sessions' references, which intraday bars take from the daily ones, and buys what went ex back in; a session without one, such as today's while it trades, is read as traded.",
      "11. A backtest is what these rules would have done at these costs on these bars, never a forecast. Do not propose an order from it alone: the user decides, and order-proposal still applies."
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
      "- Stock ticks: 0.01 below 10, 0.05 below 50, 0.1 below 100, 0.5 below 500, 1 below 1,000, then 5. ETF, ETN and REIT ticks: 0.01 below 50, then 0.05. The app tells which a listing takes from its code.",
      "- Prices move at most 10% from the previous close in a day; some ETFs have no limit. The exchanges set each listing's limits after every session for the next, and check_order refuses a limit price outside them. A market order is sized at the limit-up, the most it could fill at, so it is refused for a listing with no limits or whose next limits are not out yet, as between the close and the exchanges' lists in the afternoon.",
      "- Costs: brokers charge up to 0.1425% commission on each side, and selling pays securities transaction tax (0.3% for stocks, lower for ETFs and day trades). Include them when the edge is small.",
      "- Settlement is T+2; cash must be in the account by then.",
      "- Taiwan quotes rising prices in red and falling prices in green, the opposite of the US.",
      "- get_flows says who traded after each session. Read the week and the month and the runs, not one session: foreign flows carry ETF and index arbitrage, and dealer hedging follows the warrants dealers issued. Margin purchases rising while the price falls are holders who may be forced to sell.",
      "- get_sectors gives the session by industry. Each index is weighted by market value, so a few large listings carry it, as TSMC carries semiconductors, and a sector's rise is not every listing's. Value traded shows where the session's trading went, not who bought. For a sector over days or weeks, read its index's bars with get_candles. get_rotation places every sector against the TAIEX by where its price ratio stands in its own recent range and which way that is turning: a sector improving from lagging is where money has begun to move, one weakening from leading where it has begun to leave. It is a standardized position, not a return, so a leading sector may still have lost over the period."
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
      "- Whole shares only in this app, and limit orders only: the app sizes a market order at the session's limit-up, which US listings have none of.",
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
      "1. Read get_account, get_quotes and list_proposals.",
      "2. For each position, state its open gain or loss in its currency and what today's move made of it, as get_quotes gives them.",
      "3. Flag concentration: any position above 20% of the account's value in its currency, or several positions that move together.",
      "4. Flag positions with no invalidation the user has stated, and ask for one rather than inventing it.",
      "5. Report cash per currency and what pending proposals would use.",
      "6. Draw the account, following canvas, a currency at a time, since two currencies share no scale: the positions' values and the cash as shares of the account, and the open gains and losses side by side.",
      "7. Suggest at most one change, and only as a proposal the user confirms, following order-proposal."
    ),
  },
  {
    name: "watchlist-upkeep",
    source: SkillSource.BuiltIn,
    userInvocable: true,
    description:
      "A round over what the user holds and watches that brings each listing's research up to date with the news, the calendar and the filings, and ends in one briefing. Read when a scheduled task or the user asks for a round over the watchlist, a briefing, or what changed.",
    body: lines(
      "# Watchlist upkeep",
      "",
      "A round leaves each listing's report current and ends in one briefing. It makes no forecast and proposes no order: those wait for the user to ask.",
      "",
      "1. Call get_account and get_watchlist for the listings, and get_calendar for their dates ahead.",
      "2. Call get_research for each listing. One without a report is only named in the briefing: a first report is a deep analysis, which the user asks for.",
      "3. A report needs work when any of these holds. Check each, in this order.",
      "   - A newer quarter is out than the report took in: read it with get_fundamentals.",
      "   - News was read as stating one of its falsifiers: read the item before you rely on it, and say whether it did.",
      "   - An event is marked as passed: find what came of it with get_news, and with web_search when you have it.",
      "   - get_news over the days since the report was revised, 14 at most, holds a story that bears on a driver, a risk or the thesis. Call get_news once per listing.",
      "4. Call get_themes. Where an item was read as stating a signpost, read it and say whether it did, and what that means for the listings the theme names.",
      "5. Where something changed, call revise_report with only the parts that changed, following deep-analysis for how a claim, a falsifier and an event are written. Where nothing changed, leave the report alone: a revision that says nothing new hides the last one that did.",
      "6. End with the briefing, what matters most first.",
      "   - Listings whose view changed, each with what changed it and its source.",
      "   - Falsifiers news may have met and themes whose signposts news may have stated, with what you made of each.",
      "   - The dates in the coming week.",
      "   - Listings with no report, and anything you could not read or do.",
      "   Keep a listing to a line or two, and say plainly when nothing changed."
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
      "1. Call get_research. Read the report and how old each part is, how its stance has done against the index, the latest forecasts with how they came out, your record, any news read as stating a falsifier, and any event marked as passed. Where a stance has stood a quarter and trailed the index, say whether the thesis still holds before you build on it. Where a forecast missed, say what you misread; where news may have met a falsifier, read the item and say whether it did; where an event has passed, find what came of it, before going on.",
      "2. Gather evidence, keeping the as_of time of every number: get_candles and get_indicators on 1d and 1w, following technical-read; get_news over 30 days, which carries the company's announcements and its insiders' declared transfers; get_fundamentals for the filed quarters, the balance sheets and cash flows, the monthly revenue, the distributions, what the shares trade at against their earnings, their book value and their dividend, and how the company is run: how much of their shares its directors have pledged, which past half can force sales when the price falls, and the sanctions, fines and changes of control on record, each a risk to weigh; get_calendar for the dates ahead and the limits its exchange has put on its trading; get_flows, for a Taiwan listing, for who has been buying and selling it and the market; get_macro, where its sales follow the economy or exports, for the figures behind that; get_themes for the standing topics that name this listing and what watching them found; web_search and read_page, when you have them, for guidance and what the numbers do not say. A fund has no statements: follow fund-research for what it holds, what it costs and what a unit trades at against its net asset value. Compute with run_analysis.",
      "3. Call revise_report when the listing has no report, or when what you found changes it. Send only the parts that changed; the rest stays.",
      "   - A driver or a risk has two parts. point is your reading: why it matters to the thesis, and it may infer, weigh or look ahead. text is the fact it rests on and says no more than its quote: no cause, forecast, comparison or caveat the quote does not give. quote is the source's own words or figures, and source says where. Where the user set up a decisions model, it reads text against quote and the call is refused when text says more, so put every judgement in point. Leave out what you cannot source.",
      "   - A quote is checked against what this conversation read: every line of it must stand in a tool's answer, a page you read or what the user wrote. Copy it as it stands, a table's rows one to a line, and read the source before you quote it; a quote rebuilt from memory is refused. One the report already holds may be sent again as it is.",
      "   - Quote in full. Give the whole sentence, or every row of a table the fact uses, and never shorten a quote with an ellipsis: what you cut is what the fact is checked against. A fact that sums up many rows, such as a range or a low, quotes every row it covers or the line where a tool worked it out; otherwise state only the rows you quote. One fact to a claim: a second fact needs its own quote.",
      '   - A falsifier says what would show the thesis wrong, as something that happens: "monthly revenue falls year on year two months running".',
      "   - Give a valuation range only from figures you hold: the trailing EPS and the multiples the shares have traded at, both from get_fundamentals. Where earnings make no basis, as for a company at a loss or a bank, it may rest on book value, which is the close over the exchange's price to book, or on the dividend and its yield. Name what it rests on in its basis, and leave the range out when none of them holds. Where get_fundamentals says a multiple stands far from its industry's median, say what earns the gap or what it warns of: an industry is a wide class, so a gap is a question before it is a verdict.",
      "   - Events are the dates ahead that could move the shares and that get_calendar does not already list: an earnings call, a shareholders' meeting, a launch, a ruling, a policy decision. The app's calendar shows them beside its own dates, so each needs the source's own words that give the day, and its timing: set, deadline or expected. Leave out what get_calendar already has, such as a filing deadline or an ex-dividend day.",
      "   - An event whose day has passed is no longer ahead. Send events again without it, and put what came of it where it bears on the thesis: the catalysts section, a driver or a risk.",
      "   - The sections hold what stays true for quarters: the business, the financials, the valuation, the catalysts and the risks. A chart read goes stale within days, so it belongs in the forecast's rationale, never in the report.",
      "4. Call submit_forecast, once per session of the listing.",
      "   - The horizon is how many sessions ahead the forecast looks, at most 20. Look 5 to 10 ahead unless the user asks for another span; a forecast of one or two sessions says little. An event inside the horizon is no reason to shorten it: name it in the rationale and give the outer bands more of the probability for it.",
      "   - Two to four scenarios, each a band the horizon's close lands in. Together the bands hold every price once: the lowest has no low, the highest no high, and each band's high is the next band's low. Set the edges at levels the bars show.",
      "   - A forecast is judged with the cash that goes ex inside its horizon added back, bands and plan alike, so an ex-dividend day ahead moves no band. Name it in the rationale all the same, since the chart will show the fall. Stock distributed and splits are not made up for: keep the horizon short of one.",
      "   - Call get_base_rates with the horizon and your edges before you set a probability. It says how the listing's own moves over that many sessions have spread, and how often each band would have held. Start from those shares, and move away from them only as far as the evidence in your rationale carries you. A band wide enough to hold most of history says nothing, so set the edges where the spread leaves the bands worth telling apart. The record scores you against those shares.",
      "   - Before you set the probabilities, call search_history with kinds forecast and the words of your main argument, across every listing. How forecasts argued alike came out is evidence for the numbers you give; where one argued alike missed, say what differs now or give that scenario more.",
      "   - Probabilities are whole percents adding to 100. Your record shows how often the numbers you gave held; lean towards what it shows, and keep a scenario you find unlikely above zero.",
      "   - Each scenario's path gives the closes you expect on the way, by session counted from the newest daily bar, and ends at the horizon inside its band.",
      "   - direction is the way your probabilities lean from history's shares, not whether there is a trade: long where they give the bands above the last close more than get_base_rates showed and those below less, short for the reverse. Neutral is for probabilities that stay on history's, so do not call a lean neutral because the entry is poor, and a direction your numbers lean away from is refused.",
      "   - A plan is apart from the lean and only for one you would trade: entry, stop and target on the tick grid, the stop beyond a level the bars show, the target paying at least what the stop risks and 1.5 times it before you would ever propose it. Where no level pays that, lean without a plan and say why; a forecast without one is scored on its probabilities alone. Neutral takes no plan.",
      "   - Where get_calendar lists a restriction inside the horizon, say in the rationale what it does to the plan: under disposition or altered trading orders match in batches and may need paying for in advance, so an entry or a stop may fill far from its price, a run of attention notices may put the listing under disposition at the next one, and a short cannot be made while short selling is suspended.",
      "   - claims are the facts the rationale rests on, each saying no more than its quote, as in the report. What you make of them goes in the rationale.",
      "   - When the direction goes against the report's stance, give the reason in contrary.",
      "5. When a call is refused, fix what it names and call again.",
      "6. Tell the user the stance and thesis in two sentences, the scenarios with their probabilities, the plan, and what would change your mind. Say the forecast is scored once its horizon closes. The app draws the scenarios under the call and on the listing's chart, so link the chart rather than draw them again.",
      "7. Draw what the thesis rests on, following canvas: where the close stands against the valuation range and the multiples it rests on, and the quarters or months behind a driver or a risk. Draw only figures the tools gave, each as they gave it.",
      "",
      "A deep analysis ends at the forecast. Propose an order only when the user asks for one, following order-proposal."
    ),
  },
  {
    name: "fund-research",
    source: SkillSource.BuiltIn,
    userInvocable: true,
    description:
      "Reading an exchange-traded fund or note: what it holds, what it costs, and what a unit trades at against its net asset value. Read before giving a view on an ETF, an ETN or another listed fund, or when the user asks for its holdings, fees, net asset value, premium or discount.",
    body: lines(
      "# Fund research",
      "",
      "A fund files no statements. The app keeps what its exchange lists of it, its distributions, the net asset value its issuer struck for the last session it reported and what it paid out of its assets over the newest month. What it holds, the fees its prospectus sets and the value its issuer estimates through a session are published by the issuer alone, and the app keeps none of them: find them on the web, each with its date and its source, and never fill one in from memory, since holdings and fees change.",
      "",
      "1. Call get_fundamentals. For a fund the Taiwan Stock Exchange lists it opens with the kind of fund, the index it tracks or what it measures itself against, its manager and its units outstanding; a fund listed on the Taipei Exchange, as bond ETFs are, opens with none of that. For a fund listed on either it gives the net asset value and what the fund paid over the newest month, and it lists the distributions. get_calendar has the day it next goes ex.",
      "2. Find the issuer's own page for the fund with web_search: the fund's code and name with what you are after. Once a result shows the issuer's site, keep the next searches to it with sites, and read the page with read_page. Read the issuer's pages, not the Taiwan Stock Exchange's websites: their terms forbid programs from downloading their data, and what the exchange publishes as open data the app already reads.",
      "3. What it holds (成分股, 持股明細, 投資組合): the names, their weights and the date of the list. Draw the largest weights as shares, following canvas, with the rest as one part.",
      "   - An index fund follows its index, so name the index, and when it is next reviewed where the page says.",
      "   - An actively managed fund's list changes from day to day. Give its date, and never call an old list current.",
      "   - A leveraged, inverse or futures fund holds futures and swaps, not the index's shares. It aims at a multiple of one session's move, so over more sessions its return drifts from that multiple of the index's. Say so whenever the view looks further than a session.",
      "   - An exchange-traded note holds nothing: it is its issuer's debt, which pays an index's return. What matters is the issuer's credit and the indicative value (指標價值) it publishes in place of a net asset value.",
      "4. What it costs (費用率): get_fundamentals gives what the fund paid out of its assets over its newest month, each part in percent of its net assets, and that month's pace over a year. Cite them as what that month cost, not as the fees the prospectus (公開說明書) sets: the management fee (經理費) and the custody fee (保管費) are rates the issuer publishes, which you look up when the user asks for them or get_fundamentals has no month. A month the fund rebalanced pays more commission and tax on its own trades, so a year at that month's pace overstates them. The broker's commission and the transaction tax on the user's own trade are the trade's costs, not the fund's: taiwan-market has them.",
      "5. What a unit is worth (淨值): get_fundamentals gives the net asset value the issuer struck for the last session it reported, with that session's close as a premium or a discount to it. Through a session the issuer publishes an estimate (即時預估淨值) on its own pages: when the view turns on the premium now, take the newest estimate with its time and set the price of the same moment against it with run_analysis rather than by hand.",
      "   - Where the holdings trade abroad, a session's value is struck once those markets close, so it comes a day later, and an estimate made in Taipei hours rests on prices from before those markets reopen, so a gap may be the market pricing what the estimate has not seen yet.",
      "   - Check a premium or a discount before giving a view on the fund or proposing to trade it, whenever it is past 1% or past what the kind of fund shows, which is close to none for one holding Taiwan's shares and wider for one holding abroad: read the net asset values the issuer's pages list for the last few weeks, set each against that session's close from get_candles with run_analysis, and look for the issuer's notice of a quota reached (額度已滿) or of subscriptions stopped (暫停申購). A premium that has held while units could not be created can close within days once creation resumes, so a buyer at it may lose it. Say what the history showed, or that it could not be read.",
      "6. Say what you could not find or read. Without web_search and read_page, say that the holdings, the prospectus's fees, the estimate through a session and the history of its premium need a web search vendor set up, which solyx-guide explains, and give only what the app's own tools have.",
      "",
      "A deep analysis of a fund follows deep-analysis with these in place of the statements. What it holds and what it costs belong in the report, each as a claim with the issuer's own words or figures, or get_fundamentals' line for the month, as its quote. The premium of the day belongs in the forecast's rationale, since it goes stale within a session."
    ),
  },
  {
    name: "canvas",
    source: SkillSource.BuiltIn,
    userInvocable: false,
    description:
      "Drawing figures in a reply as a canvas: bars, columns, shares, ranges and lines written as an html code block, which the app draws in place of the code. Read before a reply that sets listings or periods side by side, splits a whole into shares, places a price in a range or follows a figure over time.",
    body: lines(
      "# Canvas",
      "",
      "A fenced code block whose language is html is drawn in the reply as a canvas instead of shown as code. The app draws it once the fence closes; until then the user sees a placeholder.",
      "",
      "## When to draw",
      "",
      "- Draw where the reader would otherwise line figures up in their head: three or more listings or periods side by side, a whole split into shares, a price placed in a range, a figure followed over time.",
      "- One or two figures stay in the sentence, and a table whose cells are words stays a markdown table.",
      "- Never draw again what the app draws itself. A listing's bars are on its chart, which a link opens; a forecast's scenarios show under submit_forecast and on that chart; the sectors show under get_sectors.",
      "- The canvas carries the comparison. The text still gives the answer, what it rests on and the as_of times, and every number in a canvas comes from a tool in this conversation, as in prose.",
      "- One canvas to an idea, and two or three to a long reply.",
      "",
      "## The app's marks",
      "",
      "The app sizes and places these from the figures you give as custom properties. Write each figure as its tool gave it, and never work out a width, a height or a position yourself. Put each in a <figure> whose <figcaption> names what is measured, its unit and its date, and keep the figures on the marks short.",
      "",
      "Bars set listings or items side by side. --max is the largest figure; where any is below zero, --min is the lowest.",
      "",
      "<figure><figcaption>Gross margin, 2026 Q2, %</figcaption>",
      '<ol class="bars" style="--max: 58.6">',
      '<li class="key" style="--v: 58.6"><span>2330 TSMC</span><b>58.6</b></li>',
      '<li style="--v: 34.1"><span>2303 UMC</span><b>34.1</b></li>',
      "</ol></figure>",
      "",
      "Columns follow one figure over at most twelve periods, oldest first, on the same --max and --min.",
      "",
      '<ol class="cols" style="--min: -12.4; --max: 35.9">',
      '<li style="--v: 35.9"><b>35.9</b><span>Jan</span></li>',
      '<li style="--v: -12.4"><b>-12.4</b><span>Feb</span></li>',
      "</ol>",
      "",
      "Shares split one whole into at most six parts, largest first. --v is each part's weight or amount as its tool gave it, all in one unit, and the bar divides itself. Class rest marks the part left unbroken.",
      "",
      '<ol class="shares">',
      '<li style="--v: 57.3"><span>2330 TSMC <b>57.3%</b></span></li>',
      '<li class="rest" style="--v: 42.7"><span>49 others <b>42.7%</b></span></li>',
      "</ol>",
      "",
      "Ranges place a band and a price on a scale from --lo to --hi, which you set a little outside every figure on it: --a and --b are the band's ends and --v the price, and a row may leave either out.",
      "",
      '<ol class="ranges" style="--lo: 700; --hi: 1300">',
      '<li style="--a: 905; --b: 1180; --v: 1045"><span>15 to 20 times EPS</span><b>905 to 1,180</b></li>',
      "</ol>",
      "",
      "A line follows a figure over more points than columns hold. Its viewBox is the data's own box: 0, the scale's low, the number of points less one, and the scale's high less its low. A point is its place in the series, from 0, and its figure. Say the scale's ends in the caption. Past a dozen points, have run_analysis return the points and the scale's ends, and copy them as they stand. At most three lines, the subject first, each with a row in keys in the same order; a <line> draws a level.",
      "",
      '<svg class="line" viewBox="0 94 59 18" preserveAspectRatio="none">',
      '<polyline points="0,100 1,100.8 2,99.6"/>',
      '<polyline points="0,100 1,100.2 2,99.1"/>',
      '<line x1="0" x2="59" y1="100" y2="100"/>',
      "</svg>",
      '<ul class="keys"><li>2330 <b>108.4</b></li><li>TAIEX <b>103.1</b></li></ul>',
      "",
      "- Class key on an item draws it in the accent: the one the reply is about. The rest stay grey.",
      "- Where the figures are price moves or gains, add class tw or us for the listing's market, to the list or to each item of a mixed one. A rise and a fall then take the colours the user has for them, from each figure's sign.",
      "",
      "## Anything else",
      "",
      "- What the marks do not cover is yours to draw, with HTML, CSS and inline SVG only. Scripts do not run, so a <canvas> element stays blank, and nothing loads: no images, fonts, stylesheets or frames from anywhere. Put every style in a <style> element or a style attribute.",
      "- Colour with the app's custom properties, so the canvas follows the user's theme: --background, --foreground, --surface, --surface-secondary, --muted, --separator, --border, --accent, --accent-foreground and --radius. Leave the page's background transparent.",
      "- Red and green mean price direction and nothing else. A rise is var(--tw-rise) or var(--us-rise) and a fall var(--tw-fall) or var(--us-fall), for the listing's market; they follow which colour the user has rise. Never write a red or green of your own.",
      "- The canvas is as wide as the reply, often under 480px, and as tall as what it holds. Size with percentages, flex or grid, give an svg a viewBox and width 100%, and never set a fixed width wider than that.",
      "- Write its labels in the reply's language. A link in a canvas opens in the browser only after the user confirms it, as in the reply."
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
      "- A desktop app for trading Taiwan (TWSE, TPEx) and US stocks. You research and may propose an order; the user confirms or dismisses it in the app, and only then does it reach the broker, unless a trading mandate the user set in Settings → Trading covers it: a limit order on listings, sides and values they chose, for some days, which is in shadow mode, only marking what it would send, unless they switched that off. The account is paper, with no real money, until the user picks a live broker there.",
      "- A stop or target on a position held is a proposal too, which the user can also make in the order panel, the Trade tab of the app's right-hand pane: once they confirm it, the broker watches the price and sells at it itself, Fubon even while the app is closed. The mandate never sends one.",
      "- Everything runs on the user's computer on their own keys. The app runs no server between them and their providers.",
      "",
      "## First-time setup, in the order the app's own setup takes",
      "1. Market data, for Taiwan's charts, quotes and news: a Fugle API key, or Fubon. Fubon's sign-in is set up in Settings → Brokers, which trading a Fubon account uses too: its SDK, which the user downloads from Fubon and the app loads from the folder they pick, the certificate exported from Fubon's website, their ID number and API key. A failed Fubon sign-in is not tried again on its own, since repeated failures could lock the account: the user fixes the settings or signs in again on that tab.",
      "2. The agent's model: a provider switched on with its API key saved, or OpenAI signed in with ChatGPT. The default model, its thinking and who decides forecasts and proposals (the agent alone, or the MAGI's three units, at three more requests each time) are on the same tab.",
      "3. Web search: a Firecrawl, Exa or Tavily key. Without one you have no web_search or read_page, and news searches only its sources that need no key.",
      "4. A decisions model (TypeSafe, Cloudflare Workers AI or OpenAI) scores news, checks the claims in research against their quotes, and judges shell commands for the auto approval mode. Without one, news goes unscored and auto asks about every command.",
      "- Optional: a FinMind token raises its request limit, and a paid plan raises it further; fundamentals and investor flows work without one, trading restrictions come from the exchanges' open data, and funds' net asset values and costs from SITCA's, neither of which needs a key. Embeddings, experimental, group news by meaning.",
      "",
      "## Keys, tokens and sign-ins",
      "- The user enters them on the tab, never in the conversation: the app keeps them encrypted in the computer's secret store and never shows them again, while whatever is written in a conversation is kept with it and sent to the model's provider. Where the computer has no secret store, nothing can be saved.",
      "- If the user pastes one, do not repeat it. Tell them it is now in the conversation and was sent to the model's provider, and that they should revoke it with whoever issued it and save a new one on the tab.",
      "",
      "## Conversations",
      "- Each conversation has an approval mode the user sets in the composer: ask, where calls that need it wait for them; auto, where a shell command the decisions model judges harmless runs and a page your searches found is read; and bypass, where they all run unasked. Order proposals wait for the user to confirm, whatever the mode, unless their trading mandate covers one.",
      "- A conversation may pick its own model and thinking; otherwise it runs on the default.",
      "- The user may start a message with /name to ask for a skill, and write @ before a code to name a listing they have on screen, hold or watch. The composer suggests both as they type, and the Skills tab shows each skill that can be asked for as /name.",
      "",
      "## Scheduled tasks",
      "- On the Scheduled tasks tab the user writes messages the app sends you on its own while it is open: at a time of day on their clock, every day or only on the days a market trades, every so often, or when something changed for what they hold and watch: news that may state a report's falsifier or a theme's signpost, or a report's event whose day went by. Each run is a conversation of its own, marked with its task, where they read what you did. A time the app was closed through is made up for once, when it opens within half a day.",
      "- Each task says how its calls that must ask get past with nobody there: wait for the user, or auto as in a conversation. No task runs every call unasked, and a proposal always waits for them.",
      "- get_tasks reads their tasks, and save_task keeps a new one or writes one again once the user allows it; only they remove one, on the tab. A task you keep runs its calls as auto unless you are told otherwise. /watchlist-upkeep is the round over what they hold and watch.",
      "- The same tab times what the app collects on its own, with no model: the news of what they hold and watch, and the news for their themes, each every so often or at a time of day. You may switch either on or off or set its span in hours with change_setting; a time of day is theirs to set there.",
      "",
      "## Themes",
      "- A theme is a topic in the world the user has the app watch because it could reach what they hold over quarters. The overview lists them, and the Themes tab is where they are written, searched now and removed. You may write one with save_theme once the user allows it; only they remove one.",
      "- Each theme's queries are searched for news once a day through the web search vendor, so nothing is searched until its key is saved, and a decisions model reads what is found against the theme's signposts, so without one nothing is read. A theme stays quiet until an item reads as stating a signpost.",
      "",
      "## Files the user writes for you",
      "- The config folder (get_setup gives its path) holds config.json, every setting as JSON with config.schema.json documenting each entry; a saved edit applies without a restart. Beside it: skills/<name>/SKILL.md for their own playbooks, which replace a built-in of the same name, and which user-invocable: false in the frontmatter keeps from being asked for with /name; AGENTS.md for standing instructions sent with every message; mcp.json for MCP servers.",
      "- Skills in ~/.agents/skills are offered only once the user switches each on, on the Skills tab.",
      "- MCP servers: each tool is off, asks first, or runs on its own, which only a tool its server marks read-only may. A secret an entry names as secret:NAME is entered on the MCP tab, and a remote server may need the user to sign in there.",
      "",
      "## The rest",
      "- Watchlist: the user adds the listing on screen with the button above its chart, and reorders or removes rows in the symbols pane. change_watchlist adds or removes listings for them once they allow it.",
      "- The shell is off until the user switches it on, and stays off while the account is live; each command waits for them unless the approval mode lets it run.",
      "- Trading: the user may lock every order, on the Trading tab or with the lock in the title bar, and set the most a day's sales may lose in each currency, past which buys are refused while sales still go. check_order names either when it refuses an order.",
      "- Memory: you save and rewrite memories on your own as you learn the user, and each waits for them only where the conversation asks first; forgetting one waits for them unless nothing asks. They read and edit them on the Memory tab, or switch memory off there.",
      "- Updates: the app checks every six hours while that setting is on. Windows installs on restart; on macOS the update is linked for the user to download.",
      "- Storage: get_setup says how much each store holds. Only the user clears one, on the Storage tab, and you cannot: chart bars are a cache that fills again, and everything else cleared is gone for good, conversations, memories, news, research and the watchlist alike, so say what would be lost before you send them there. News also ages out on its own after the time get_setup names, which only the user sets, on the same tab.",
      "",
      "## Changing settings",
      "- change_setting changes a setting get_setup says it takes, such as the theme, the default model and thinking, who decides forecasts and proposals, data sources and plans, whether and how often news and themes are collected, and the vendors in use. Use it when the user asks for that change or agrees to one you suggested, and say what the change does first. The user allows each change unless the conversation's approval mode lets it run, and it applies at once.",
      "- Keys, sign-ins, the providers switched on, endpoints, the shell, MCP tools, shared skills, memory and the limits on orders only the user changes: walk them to the tab with its link and say what to pick."
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
   * metadata breaks the Agent Skills format is still offered when it has a description and its
   * folder's name.
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
 * Every `<folder>/<name>/SKILL.md` under `root`. A skill without a description or whose name
 * differs from its folder is left out, and one hidden with `disable-model-invocation` too; other
 * breaks of the format are reported but keep the skill. `user-invocable: false` keeps it from being asked for with `/name`, as other
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

    // A skill is switched on and hides later ones by its folder, so a name its folder does not
    // give could stand in for another skill.
    if (name !== folder) {
      report(`name "${name}" does not match its folder "${folder}"`);

      continue;
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
 * then shared skills whose folders the user switched on in `sharedEnabled`. A name taken by an
 * earlier source hides later ones, so a shared skill never replaces a trading playbook. Skills
 * marked `disable-model-invocation` are left out.
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
export async function loadInstructions(file: string) {
  return (await readTextIfExists(file))?.trim() || undefined;
}
