import type { ClaimAuditor } from "@solyx/core/report";
import type { SentimentScorer } from "@solyx/core/sentiment";
import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareClaimAuditor,
  createCloudflareCommandJudge,
  createCloudflareScorer,
} from "@solyx/decisions/cloudflare";
import type { CommandJudge } from "@solyx/decisions/command";
import { DecisionsProvider } from "@solyx/decisions/provider";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeClaimAuditor,
  createTypeSafeCommandJudge,
  createTypeSafeScorer,
} from "@solyx/decisions/typesafe";

import { DECISIONS_SECRETS } from "#shared/ipc/settings.ts";
import type { DecisionsSettings } from "#shared/ipc/settings.ts";

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

/**
 * The decisions model the config file and the saved key pick. Each scorer reads them afresh, so
 * a changed provider, key, model or endpoint applies to the next text without a restart.
 */
export function createDecisions({ config, secrets }: DecisionsOptions) {
  /** Each provider's settings, with its default for every entry the config file does not set. */
  function read() {
    const { provider, typesafe, cloudflare } = config.read().decisions;

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
    };
  }

  function settings(): DecisionsSettings {
    const { provider, typesafe, cloudflare } = read();

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
      ],
    };
  }

  /** What the provider's model answers; `undefined` until the user saves what the provider needs. */
  async function model(): Promise<
    | { scorer: SentimentScorer; judge: CommandJudge; auditor: ClaimAuditor }
    | undefined
  > {
    const { provider, typesafe, cloudflare } = read();
    const apiKey = await secrets.get(DECISIONS_SECRETS[provider]);

    if (apiKey === undefined) return undefined;

    if (provider === DecisionsProvider.TypeSafe) {
      return {
        scorer: createTypeSafeScorer({ apiKey, ...typesafe }),
        judge: createTypeSafeCommandJudge({ apiKey, ...typesafe }),
        auditor: createTypeSafeClaimAuditor({ apiKey, ...typesafe }),
      };
    }

    const { accountId, ...endpoint } = cloudflare;

    if (accountId === null) return undefined;

    return {
      scorer: createCloudflareScorer({ apiKey, accountId, ...endpoint }),
      judge: createCloudflareCommandJudge({ apiKey, accountId, ...endpoint }),
      auditor: createCloudflareClaimAuditor({ apiKey, accountId, ...endpoint }),
    };
  }

  return {
    settings,

    /** `undefined` until the user saves a key, and for Cloudflare an account. */
    scorer: async () => (await model())?.scorer,

    /** Judges the agent's shell commands; `undefined` until the user saves a key, and for Cloudflare an account. */
    commandJudge: async () => (await model())?.judge,

    /** Reads the agent's claims against their quotes; `undefined` until the user saves a key, and for Cloudflare an account. */
    claimAuditor: async () => (await model())?.auditor,
  };
}

export type Decisions = ReturnType<typeof createDecisions>;
