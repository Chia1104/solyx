/** An answer as it was kept, with when it was asked for. */
export interface KeptAnswer<Answer> {
  askedAt: number;
  answer: Answer;
}

/** Where one scope's answers are kept, each under its key. */
export interface AnswerStore<Answer> {
  read(key: string): KeptAnswer<Answer> | undefined;
  write(key: string, kept: KeptAnswer<Answer>): void;
  /** Drops every answer kept. */
  forget(): void;
}

/** Hands out each scope's store; a scope is a name one reader keeps one kind of answer under. */
export type AnswerStores = <Answer>(scope: string) => AnswerStore<Answer>;

/** Whether an answer asked for at `askedAt` still serves at `now`. */
export type Freshness<Key> = (
  key: Key,
  askedAt: number,
  now: number
) => boolean;

/** Fresh for `ms` after it was asked for. */
export const freshFor =
  (ms: number): Freshness<unknown> =>
  (_key, askedAt, now) =>
    now - askedAt < ms;

export interface KeepFreshOptions<Key, Answer> {
  store: AnswerStore<Answer>;
  /** The key an answer is kept under, one per answer. */
  id: (key: Key) => string;
  ask: (key: Key) => Promise<Answer>;
  fresh: Freshness<Key>;
  /** @default Date.now */
  now?: () => number;
}

export interface KeptFresh<Key, Answer> {
  (key: Key): Promise<Answer>;
  /** Drops every answer kept, and keeps nothing an ask under way brings back. */
  forget(): void;
}

/**
 * Serves each key's answer from the store while it is fresh, and otherwise asks and keeps what
 * comes back: a failure keeps nothing, so the next read asks again, and readers that come while
 * an ask is under way share it rather than asking too.
 */
export function keepFresh<Key, Answer>({
  store,
  id,
  ask,
  fresh,
  now = Date.now,
}: KeepFreshOptions<Key, Answer>): KeptFresh<Key, Answer> {
  const asking = new Map<string, Promise<Answer>>();
  let forgets = 0;

  function read(key: Key): Promise<Answer> {
    const under = id(key);
    const shared = asking.get(under);

    if (shared) return shared;

    const at = now();
    const held = store.read(under);

    if (held && fresh(key, held.askedAt, at))
      return Promise.resolve(held.answer);

    const before = forgets;

    const answer = ask(key)
      .then((answer) => {
        if (forgets === before) store.write(under, { askedAt: at, answer });

        return answer;
      })
      .finally(() => {
        if (asking.get(under) === answer) asking.delete(under);
      });

    asking.set(under, answer);

    return answer;
  }

  return Object.assign(read, {
    forget() {
      forgets += 1;
      asking.clear();
      store.forget();
    },
  });
}

/** Answers kept in memory alone, for tests and hosts without a database. */
export function memoryAnswers(): AnswerStores {
  const scopes = new Map<string, Map<string, KeptAnswer<unknown>>>();

  return <Answer>(scope: string): AnswerStore<Answer> => {
    const kept =
      scopes.get(scope) ??
      scopes.set(scope, new Map()).get(scope) ??
      new Map<string, KeptAnswer<unknown>>();

    return {
      // SAFETY: a scope's answers are written by `write` below with the `Answer` its one reader keeps.
      read: (key) => kept.get(key) as KeptAnswer<Answer> | undefined,
      write(key, answer) {
        kept.set(key, answer);
      },
      forget: () => kept.clear(),
    };
  };
}
