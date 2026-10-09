import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { Investor } from "@solyx/core/flows";
import type { Flows, ListingFlows, MarketFlows } from "@solyx/core/flows";
import { Market } from "@solyx/core/market";

import { createFlowTools } from "../src/flows.ts";
import { AgentToolName } from "../src/wire.ts";

// 2026-10-09 10:00 in Taipei.
const NOW = new Date("2026-10-09T02:00:00Z");

const TSMC = { market: Market.TW, symbol: "2330" };

const LISTING: ListingFlows = {
  trades: [
    {
      date: "2026-10-07",
      investor: Investor.Foreign,
      bought: 9_935_838,
      sold: 11_099_189,
    },
    {
      date: "2026-10-07",
      investor: Investor.InvestmentTrust,
      bought: 297_163,
      sold: 230_237,
    },
    {
      date: "2026-10-08",
      investor: Investor.Foreign,
      bought: 7_131_686,
      sold: 19_434_673,
    },
    {
      date: "2026-10-08",
      investor: Investor.InvestmentTrust,
      bought: 829_300,
      sold: 36_437,
    },
  ],
  margin: [
    {
      date: "2026-10-07",
      margin: 30_278_000,
      marginLimit: 6_483_092_000,
      short: 50_000,
    },
    {
      date: "2026-10-08",
      margin: 31_586_000,
      marginLimit: 6_483_092_000,
      short: 45_000,
    },
  ],
  foreign: [
    { date: "2026-10-07", ratio: 0.6919, limit: 1 },
    { date: "2026-10-08", ratio: 0.6914, limit: 1 },
  ],
};

const MARKET: MarketFlows = {
  trades: [
    {
      date: "2026-10-08",
      investor: Investor.Foreign,
      bought: 286_056_136_234,
      sold: 361_908_429_724,
    },
  ],
  margin: [
    {
      date: "2026-10-07",
      marginValue: 640_000_774_000,
      margin: 9_358_246_000,
      short: 215_104_000,
    },
    {
      date: "2026-10-08",
      marginValue: 646_405_767_000,
      margin: 9_406_720_000,
      short: 211_949_000,
    },
  ],
  futures: [
    {
      date: "2026-10-07",
      investor: Investor.Foreign,
      long: 12_000,
      short: 90_000,
    },
    {
      date: "2026-10-08",
      investor: Investor.Foreign,
      long: 11_389,
      short: 94_583,
    },
    {
      date: "2026-10-08",
      investor: Investor.InvestmentTrust,
      long: 79_091,
      short: 2_752,
    },
  ],
};

function setup() {
  const flows = {
    listing: vi.fn<Flows["listing"]>(async () => LISTING),
    market: vi.fn<Flows["market"]>(async () => MARKET),
  };

  const [tool] = createFlowTools({ flows, now: () => NOW }).tools ?? [];

  const run = async (params: Parameters<ToolRegistration["execute"]>[0]) => {
    // SAFETY: get_flows never uses its call's api.
    const api = {} as ToolExecutionApi;
    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.content ?? []), details: result.details };
  };

  return { tool, run, flows };
}

test("reads a listing's flows in lots and the market's in millions, as the app computed them", async () => {
  const { tool, run, flows } = setup();

  expect(tool.name).toBe(AgentToolName.GetFlows);

  const { text, details } = await run({ symbol: TSMC });

  expect(flows.listing).toHaveBeenCalledWith(TSMC);
  expect(flows.market).toHaveBeenCalledWith(Market.TW);
  expect(text.split("\n")).toEqual([
    "Flows as_of 2026-10-09 10:00 Taipei; a week is 5 sessions and a month 20",
    "TW 2330 in lots of 1000 shares:",
    "Net buying through 2026-10-08, bought less sold, over the newest session, a week and a month, and the run of sessions on the newest one's side:",
    "investor,session,week,month,run",
    "foreign,-12303,-13466,-13466,sold 2",
    "investment trust,+793,+860,+860,bought 2",
    "Margin purchases on 2026-10-08: 31586 lots, 0.5% of the limit; change +1308 over a session, n/a over a week, n/a over a month",
    "Short sales on 2026-10-08: 45 lots, 0.1% of margin purchases; change -5 over a session, n/a over a week, n/a over a month",
    "Foreign holding on 2026-10-08: 69.14% of the shares issued, limit 100.00%; in percentage points, change -0.05 over a session, n/a over a week, n/a over a month",
    "TW market, trades in TWD millions:",
    "Net buying through 2026-10-08, bought less sold, over the newest session, a week and a month, and the run of sessions on the newest one's side:",
    "investor,session,week,month,run",
    "foreign,-75852,-75852,-75852,sold 1",
    "Margin lending on 2026-10-08: TWD 646406 million; change +6405 over a session, n/a over a week, n/a over a month",
    "Short sales on 2026-10-08: 211949 lots, 2.3% of the 9406720 lots bought on margin",
    "TAIEX futures, net open interest in contracts (long less short) through 2026-10-08:",
    "investor,net,session,week,month",
    "foreign,-83194,-5194,n/a,n/a",
    "investment trust,+76339,n/a,n/a,n/a",
  ]);
  expect(details).toEqual({ market: Market.TW, symbol: TSMC });
});

test("without a listing it reads the market's alone, and outside Taiwan nothing", async () => {
  const { run, flows } = setup();

  const { text } = await run({});

  expect(flows.listing).not.toHaveBeenCalled();
  expect(text).not.toContain("lots of 1000 shares");
  expect(text).toContain("TW market, trades in TWD millions:");

  expect(
    (await run({ symbol: { market: Market.US, symbol: "AAPL" } })).text
  ).toBe(
    "No flows for US: only Taiwan's exchanges report who trades each session."
  );
  expect(flows.market).toHaveBeenCalledTimes(1);
});
