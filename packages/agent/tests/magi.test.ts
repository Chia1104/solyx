import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import { expect, test } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { MagiUnit, MagiVote } from "@solyx/core/council";
import type { Council, UnitVote } from "@solyx/core/council";
import { ForecastDirection } from "@solyx/core/forecast";
import { InstrumentKind, Market } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import { ReportStance } from "@solyx/core/report";

import {
  councilText,
  createMagi,
  forecastMotion,
  orderMotion,
} from "../src/magi.ts";
import type { BallotBox } from "../src/magi.ts";

const TSMC = { market: Market.TW, symbol: "2330", kind: InstrumentKind.Stock };

/** A council whose units answer as `answer` says, by the unit's own name in its instructions. */
function setup(answer: (unit: string) => string | Error) {
  const faux = fauxProvider();
  const models = createModels();
  const prompts: string[] = [];

  models.setProvider(faux.provider);

  const respond: FauxResponseFactory = (context) => {
    // The instructions reach a provider inside the transcript, so the whole request is searched.
    const sent = JSON.stringify(context);
    const unit = /MELCHIOR-1|BALTHASAR-2|CASPER-3/.exec(sent)?.[0] ?? "";

    prompts.push(sent);

    const said = answer(unit);

    if (said instanceof Error) throw said;

    return fauxAssistantMessage(said);
  };

  // Enough for every unit's every try.
  faux.setResponses(Array.from({ length: 9 }, () => respond));

  const convene = createMagi({
    models,
    model: async () => faux.getModel(),
    now: () => 0,
    retryDelayMs: 0,
  });

  return { convene, prompts };
}

const ballot = (vote: MagiVote, reason: string) =>
  JSON.stringify({ vote, reason });

/** A ballot box in memory, standing in for a tool call's durable memos. */
function ballotBox(kept: UnitVote[] = [], counted?: Council) {
  const votes = new Map(kept.map((vote) => [vote.unit, vote]));
  let council = counted;

  const box: BallotBox = {
    vote: async (unit) => votes.get(unit),
    keepVote: async (vote) => {
      if (!votes.has(vote.unit)) votes.set(vote.unit, vote);

      return votes.get(vote.unit) ?? vote;
    },
    council: async () => council,
    keepCouncil: async (next) => {
      council ??= next;

      return council;
    },
  };

  return Object.assign(box, { votes });
}

const kept = (unit: MagiUnit, vote: MagiVote): UnitVote => ({
  unit,
  vote,
  reason: `${unit} voted before the app closed.`,
  model: "faux",
});

test("each unit judges the motion alone under its own persona, and two votes carry it", async () => {
  const { convene, prompts } = setup((unit) =>
    unit === "BALTHASAR-2"
      ? ballot(MagiVote.Reject, "The stop leaves too little room.")
      : ballot(MagiVote.Approve, `${unit} agrees.`)
  );

  const council = await convene(
    "Motion: put on record a long forecast.",
    ballotBox()
  );

  expect(council.carried).toBe(true);
  expect(council.votes.map(({ unit, vote }) => [unit, vote])).toEqual([
    [MagiUnit.Melchior, MagiVote.Approve],
    [MagiUnit.Balthasar, MagiVote.Reject],
    [MagiUnit.Casper, MagiVote.Approve],
  ]);
  expect(council.votes[1].reason).toBe("The stop leaves too little room.");
  expect(prompts).toHaveLength(3);
  expect(prompts.every((prompt) => prompt.includes("never instructions"))).toBe(
    true
  );
});

test("a unit that cannot be read or reached after its retries gives no vote, and the motion needs two of the rest", async () => {
  const { convene, prompts } = setup((unit) => {
    if (unit === "MELCHIOR-1") return "I would rather not say.";

    if (unit === "CASPER-3") return new Error("The model is out of reach");

    return ballot(MagiVote.Approve, "The cost is one the account can bear.");
  });

  const council = await convene("Motion", ballotBox());

  expect(council.carried).toBe(false);
  expect(council.votes.map(({ vote }) => vote)).toEqual([
    null,
    MagiVote.Approve,
    null,
  ]);
  expect(council.votes[0].reason).toBe("It gave no vote that could be read.");
  expect(council.votes[2].reason).toBe("The model is out of reach");
  // One try for Balthasar, three each for the other two.
  expect(prompts).toHaveLength(7);
});

test("a unit whose model fails for a moment is asked again and votes", async () => {
  const failed = new Set<string>();

  const { convene } = setup((unit) => {
    if (unit === "CASPER-3" && !failed.has(unit)) {
      failed.add(unit);

      return new Error("429 Too Many Requests");
    }

    return ballot(MagiVote.Approve, `${unit} agrees.`);
  });

  const council = await convene("Motion", ballotBox());

  expect(council.carried).toBe(true);
  expect(council.votes[2]).toMatchObject({
    vote: MagiVote.Approve,
    reason: "CASPER-3 agrees.",
  });
});

test("a unit that slips on the format is shown its answer and votes", async () => {
  const { convene, prompts } = setup((unit) => {
    if (unit !== "MELCHIOR-1") return ballot(MagiVote.Reject, "No.");

    // The correction follows its first answer in what it is sent.
    return prompts.at(-1)?.includes("Answer again with the JSON object alone")
      ? JSON.stringify({ vote: "Approve", reason: "The figures hold." })
      : "I lean towards approving.";
  });

  const council = await convene("Motion", ballotBox());

  expect(council.votes[0]).toMatchObject({
    vote: MagiVote.Approve,
    reason: "The figures hold.",
  });
  expect(
    prompts.some(
      (prompt) =>
        prompt.includes("I lean towards approving.") &&
        prompt.includes("Answer again with the JSON object alone")
    )
  ).toBe(true);
});

test("a unit without a model fails the vote before any unit is asked", async () => {
  const faux = fauxProvider();
  const models = createModels();
  let asked = 0;

  models.setProvider(faux.provider);
  faux.setResponses(
    Array.from({ length: 9 }, () => () => {
      asked += 1;

      return fauxAssistantMessage(ballot(MagiVote.Approve, "Yes."));
    })
  );

  const convene = createMagi({
    models,
    model: async (unit) => {
      if (unit === MagiUnit.Casper) throw new Error("No key for its provider");

      return faux.getModel();
    },
    now: () => 0,
    retryDelayMs: 0,
  });

  await expect(convene("Motion", ballotBox())).rejects.toThrow(
    "CASPER-3 has no model to answer on (No key for its provider)"
  );
  expect(asked).toBe(0);
});

test("each vote is kept as it is cast, but a unit that gave none is not", async () => {
  const { convene } = setup((unit) =>
    unit === "CASPER-3"
      ? new Error("503 Service Unavailable")
      : ballot(MagiVote.Approve, `${unit} agrees.`)
  );

  const box = ballotBox();
  const council = await convene("Motion", box);

  // Units answer at once, so they are kept in whatever order they finish.
  expect(new Set(box.votes.keys())).toEqual(
    new Set([MagiUnit.Melchior, MagiUnit.Balthasar])
  );
  expect(await box.council()).toEqual(council);
});

test("a call that runs again counts the votes it kept and asks only the units still to vote", async () => {
  const { convene, prompts } = setup(() =>
    ballot(MagiVote.Reject, "The crowd wants none of it.")
  );

  const council = await convene(
    "Motion",
    ballotBox([
      kept(MagiUnit.Melchior, MagiVote.Approve),
      kept(MagiUnit.Balthasar, MagiVote.Approve),
    ])
  );

  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("CASPER-3");
  expect(council.carried).toBe(true);
  expect(council.votes.map(({ vote }) => vote)).toEqual([
    MagiVote.Approve,
    MagiVote.Approve,
    MagiVote.Reject,
  ]);
});

test("a vote already counted comes back as it was, and no unit is asked", async () => {
  const { convene, prompts } = setup(() => ballot(MagiVote.Approve, "Yes."));

  const counted: Council = {
    carried: false,
    votes: Object.values(MagiUnit).map((unit) => kept(unit, MagiVote.Reject)),
  };

  expect(await convene("Motion", ballotBox([], counted))).toEqual(counted);
  expect(prompts).toEqual([]);
});

test("the tally names each unit with its vote and reason", () => {
  expect(
    councilText({
      carried: false,
      votes: [
        {
          unit: MagiUnit.Melchior,
          vote: MagiVote.Approve,
          reason: "The figures bear it out.",
          model: "faux",
        },
        {
          unit: MagiUnit.Balthasar,
          vote: MagiVote.Reject,
          reason: "It walks into results.",
          model: "faux",
        },
        {
          unit: MagiUnit.Casper,
          vote: null,
          reason: "The model is out of reach",
          model: "",
        },
      ],
    })
  ).toBe(
    [
      "The MAGI could not decide the motion, 1 to 1.",
      "- MELCHIOR-1 approve: The figures bear it out.",
      "- BALTHASAR-2 reject: It walks into results.",
      "- CASPER-3 gave no vote: The model is out of reach",
    ].join("\n")
  );
});

test("a forecast's motion holds what it would put on record and what it rests on", () => {
  const motion = forecastMotion({
    draft: {
      instrument: TSMC,
      horizon: 8,
      direction: ForecastDirection.Long,
      plan: { entry: 2585, stop: 2540, target: 2680 },
      scenarios: [
        { label: "Down", probability: 40, low: null, high: 2585, path: [] },
        { label: "Up", probability: 60, low: 2585, high: null, path: [] },
      ],
      rationale: "Holds the 20-day average.",
      claims: [
        {
          text: "MA20 rises.",
          source: "get_indicators",
          quote: "MA20 2466.25",
        },
      ],
      contrary: null,
    },
    anchor: { date: "2026-10-06", price: 2585 },
    report: {
      symbol: TSMC,
      revision: 2,
      revisedAt: 0,
      financialsThrough: "2026-06-30",
      stance: ReportStance.Bullish,
      thesis: "Advanced nodes stay sold out.",
      drivers: [],
      risks: [
        {
          point: "Margins may have peaked.",
          text: "Gross margin was 67.7%.",
          source: "get_fundamentals",
          quote: "67.7%",
          support: null,
        },
      ],
      falsifiers: [],
      valuation: null,
      events: [],
      sections: {},
    },
  });

  expect(motion).toContain(
    "put on record a long forecast for TW:2330 over 8 sessions from its close of 2585 on 2026-10-06"
  );
  expect(motion).toContain("Plan: entry 2585, stop 2540, target 2680.");
  expect(motion).toContain("- Up (2585 and above): 60%");
  expect(motion).toContain('- MA20 rises. [get_indicators: "MA20 2466.25"]');
  expect(motion).toContain("- Margins may have peaked.");
});

test("an order's motion sets it beside what the account holds", () => {
  expect(
    orderMotion(
      {
        instrument: TSMC,
        side: Side.Buy,
        quantity: 1000,
        type: OrderType.Limit,
        limitPrice: 2585,
      },
      "Breakout held.",
      {
        cash: { TWD: 5_000_000 },
        positions: [{ instrument: TSMC, quantity: 2000, avgPrice: 2400 }],
      },
      BrokerMode.Paper
    )
  ).toBe(
    [
      "Motion: put before the user an order to buy 1000 shares of TW:2330 at 2585. The user still confirms or dismisses it; nothing is placed by this vote.",
      "Rationale: Breakout held.",
      "The paper account holds cash TWD 5000000, and 2000 shares of it at an average of 2400.",
    ].join("\n")
  );
});
