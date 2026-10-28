import { noop } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import { HOUR_MS } from "../src/date.ts";
import { freshFor, keepFresh, memoryAnswers } from "../src/fresh.ts";

function setup() {
  const clock = { now: 0 };
  const answers = memoryAnswers();
  const ask = vi.fn(async (key: string) => `${key} at ${clock.now}`);

  const read = keepFresh({
    store: answers<string>("greetings"),
    id: (key: string) => key,
    ask,
    fresh: freshFor(HOUR_MS),
    now: () => clock.now,
  });

  return { clock, answers, ask, read };
}

test("serves the answer kept while it is fresh and asks again once it is stale", async () => {
  const { clock, ask, read } = setup();

  expect(await read("hello")).toBe("hello at 0");

  clock.now = HOUR_MS - 1;
  expect(await read("hello")).toBe("hello at 0");
  expect(ask).toHaveBeenCalledOnce();

  clock.now = HOUR_MS;
  expect(await read("hello")).toBe(`hello at ${HOUR_MS}`);
  expect(ask).toHaveBeenCalledTimes(2);
});

test("a failure keeps nothing, so the next read asks again", async () => {
  const { ask, read } = setup();

  ask.mockRejectedValueOnce(new Error("offline"));

  await expect(read("hello")).rejects.toThrow("offline");
  expect(await read("hello")).toBe("hello at 0");
  expect(ask).toHaveBeenCalledTimes(2);
});

test("kept on failure, a stale answer serves while asking fails, and a key never answered still fails", async () => {
  const clock = { now: 0 };
  const ask = vi.fn(async (key: string) => `${key} at ${clock.now}`);

  const read = keepFresh({
    store: memoryAnswers()<string>("greetings"),
    id: (key: string) => key,
    ask,
    fresh: freshFor(HOUR_MS),
    keepOnFailure: true,
    now: () => clock.now,
  });

  expect(await read("hello")).toBe("hello at 0");

  clock.now = HOUR_MS;
  ask.mockRejectedValue(new Error("offline"));

  expect(await read("hello")).toBe("hello at 0");
  // Each read past the answer's freshness asks again, so the source is read once it answers.
  expect(ask).toHaveBeenCalledTimes(2);
  await expect(read("bye")).rejects.toThrow("offline");

  read.forget();

  await expect(read("hello")).rejects.toThrow("offline");

  ask.mockImplementation(async (key: string) => `${key} at ${clock.now}`);

  expect(await read("hello")).toBe(`hello at ${HOUR_MS}`);
});

test("readers that come while an ask is under way share it", async () => {
  const { ask, read } = setup();

  const [first, second] = await Promise.all([read("hello"), read("hello")]);

  expect(first).toBe(second);
  expect(ask).toHaveBeenCalledOnce();
  expect(await read("hello")).toBe(first);
  expect(ask).toHaveBeenCalledOnce();
});

test("an answer kept serves a later reader over the same store", async () => {
  const { answers, ask, read } = setup();

  await read("hello");

  const later = keepFresh({
    store: answers<string>("greetings"),
    id: (key: string) => key,
    ask,
    fresh: freshFor(HOUR_MS),
    now: () => 0,
  });

  expect(await later("hello")).toBe("hello at 0");
  expect(ask).toHaveBeenCalledOnce();
});

test("forgetting drops what is kept, and what an ask under way brings back", async () => {
  const { ask, read } = setup();
  let answer: () => void = noop;

  ask.mockImplementationOnce(
    (key) =>
      new Promise((resolve) => {
        answer = () => resolve(`${key} before forgetting`);
      })
  );

  const underWay = read("hello");

  read.forget();
  answer();

  expect(await underWay).toBe("hello before forgetting");
  expect(await read("hello")).toBe("hello at 0");
  expect(ask).toHaveBeenCalledTimes(2);
});

test("scopes keep their answers apart", async () => {
  const answers = memoryAnswers();

  answers<number>("a").write("key", { askedAt: 0, answer: 1 });
  answers<number>("b").write("key", { askedAt: 0, answer: 2 });
  answers<number>("a").forget();

  expect(answers<number>("a").read("key")).toBeUndefined();
  expect(answers<number>("b").read("key")).toEqual({ askedAt: 0, answer: 2 });
});
