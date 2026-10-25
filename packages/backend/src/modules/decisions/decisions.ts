import { DECISIONS_SECRETS } from "@solyx/api/settings";
import type { DecisionsSettings } from "@solyx/api/settings";
import type { FactReader } from "@solyx/core/forecast";
import type { ClaimAuditor } from "@solyx/core/report";
import type { SentimentScorer } from "@solyx/core/sentiment";
import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareClaimAuditor,
  createCloudflareCodeJudge,
  createCloudflareCommandJudge,
  createCloudflareFactReader,
  createCloudflareScorer,
} from "@solyx/decisions/cloudflare";
import type { CodeJudge } from "@solyx/decisions/code";
import type { CommandJudge } from "@solyx/decisions/command";
import {
  OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  createOpenAIClaimAuditor,
  createOpenAICodeJudge,
  createOpenAICommandJudge,
  createOpenAIFactReader,
  createOpenAIScorer,
} from "@solyx/decisions/openai";
import { DecisionsProvider } from "@solyx/decisions/provider";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeClaimAuditor,
  createTypeSafeCodeJudge,
  createTypeSafeCommandJudge,
  createTypeSafeFactReader,
  createTypeSafeScorer,
} from "@solyx/decisions/typesafe";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

export interface DecisionsOptions {
  config: ConfigFile;
  secrets: SecretStore;
}

const TYPESAFE_DEFAULTS = {
  model: TYPESAFE_DEFAULT_MODEL,
  baseURL: TYPESAFE_BASE_URL,
};

const CLOUDFLARE_DEFAULTS = {
  model: CLOUDFLARE_DEFAULT_MODEL,
  baseURL: CLOUDFLARE_BASE_URL,
};

const OPENAI_DEFAULTS = {
  model: OPENAI_DEFAULT_MODEL,
  baseURL: OPENAI_BASE_URL,
};

/**
 * The decisions model the config file and the saved key pick. Each scorer reads them afresh, so
 * a changed provider, key, model or endpoint applies to the next text without a restart.
 */
export function createDecisions({ config, secrets }: DecisionsOptions) {
  /** Each provider's settings, with its default for every entry the config file does not set. */
  function read() {
    const { provider, typesafe, cloudflare, openai } = config.read().decisions;

    return {
      provider,
      typesafe: {
        model: typesafe.model ?? TYPESAFE_DEFAULTS.model,
        baseURL: typesafe.baseURL ?? TYPESAFE_DEFAULTS.baseURL,
      },
      cloudflare: {
        model: cloudflare.model ?? CLOUDFLARE_DEFAULTS.model,
        baseURL: cloudflare.baseURL ?? CLOUDFLARE_DEFAULTS.baseURL,
        accountId: cloudflare.accountId ?? null,
      },
      openai: {
        model: openai.model ?? OPENAI_DEFAULTS.model,
        baseURL: openai.baseURL ?? OPENAI_DEFAULTS.baseURL,
      },
    };
  }

  function settings(): DecisionsSettings {
    const { provider, typesafe, cloudflare, openai } = read();

    return {
      provider,
      providers: [
        {
          provider: DecisionsProvider.TypeSafe,
          ...typesafe,
          defaults: TYPESAFE_DEFAULTS,
        },
        {
          provider: DecisionsProvider.Cloudflare,
          ...cloudflare,
          defaults: CLOUDFLARE_DEFAULTS,
        },
        {
          provider: DecisionsProvider.OpenAI,
          ...openai,
          defaults: OPENAI_DEFAULTS,
        },
      ],
    };
  }

  /** What the provider's model answers; `undefined` until the user saves what the provider needs. */
  async function model(): Promise<
    | {
        scorer: SentimentScorer;
        judge: CommandJudge;
        code: CodeJudge;
        auditor: ClaimAuditor;
        reader: FactReader;
      }
    | undefined
  > {
    const { provider, typesafe, cloudflare, openai } = read();
    const apiKey = await secrets.get(DECISIONS_SECRETS[provider]);

    if (apiKey === undefined) return undefined;

    switch (provider) {
      case DecisionsProvider.TypeSafe:
        return {
          scorer: createTypeSafeScorer({ apiKey, ...typesafe }),
          judge: createTypeSafeCommandJudge({ apiKey, ...typesafe }),
          code: createTypeSafeCodeJudge({ apiKey, ...typesafe }),
          auditor: createTypeSafeClaimAuditor({ apiKey, ...typesafe }),
          reader: createTypeSafeFactReader({ apiKey, ...typesafe }),
        };
      case DecisionsProvider.Cloudflare: {
        const { accountId, ...endpoint } = cloudflare;

        if (accountId === null) return undefined;

        return {
          scorer: createCloudflareScorer({ apiKey, accountId, ...endpoint }),
          judge: createCloudflareCommandJudge({
            apiKey,
            accountId,
            ...endpoint,
          }),
          code: createCloudflareCodeJudge({
            apiKey,
            accountId,
            ...endpoint,
          }),
          auditor: createCloudflareClaimAuditor({
            apiKey,
            accountId,
            ...endpoint,
          }),
          reader: createCloudflareFactReader({
            apiKey,
            accountId,
            ...endpoint,
          }),
        };
      }

      case DecisionsProvider.OpenAI:
        return {
          scorer: createOpenAIScorer({ apiKey, ...openai }),
          judge: createOpenAICommandJudge({ apiKey, ...openai }),
          code: createOpenAICodeJudge({ apiKey, ...openai }),
          auditor: createOpenAIClaimAuditor({ apiKey, ...openai }),
          reader: createOpenAIFactReader({ apiKey, ...openai }),
        };
    }
  }

  return {
    settings,

    /** `undefined` until the user saves a key, and for Cloudflare an account. */
    scorer: async () => (await model())?.scorer,

    /** Judges the agent's shell commands; `undefined` until the user saves a key, and for Cloudflare an account. */
    commandJudge: async () => (await model())?.judge,

    /** Judges the code of the user's strategies; `undefined` until the user saves a key, and for Cloudflare an account. */
    codeJudge: async () => (await model())?.code,

    /** Reads the agent's claims against their quotes; `undefined` until the user saves a key, and for Cloudflare an account. */
    claimAuditor: async () => (await model())?.auditor,

    /** Reads how the facts a forecast rests on bear on the price; `undefined` until the user saves a key, and for Cloudflare an account. */
    factReader: async () => (await model())?.reader,
  };
}

export type Decisions = ReturnType<typeof createDecisions>;
