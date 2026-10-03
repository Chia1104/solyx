import type { SentimentScorer } from "@solyx/core/sentiment";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeScorer,
} from "@solyx/decisions/typesafe";

import { Secret } from "#shared/ipc/settings.ts";
import type { DecisionsSettings } from "#shared/ipc/settings.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

export interface DecisionsOptions {
  config: ConfigFile;
  secrets: SecretStore;
}

/**
 * The decisions model the config file and the saved key pick. Each scorer reads them afresh, so
 * a changed key, model or endpoint applies to the next text without a restart.
 */
export function createDecisions({ config, secrets }: DecisionsOptions) {
  function settings(): DecisionsSettings {
    const { model, baseURL } = config.read().decisions;

    return {
      model: model ?? TYPESAFE_DEFAULT_MODEL,
      baseURL: baseURL ?? TYPESAFE_BASE_URL,
      defaults: { model: TYPESAFE_DEFAULT_MODEL, baseURL: TYPESAFE_BASE_URL },
    };
  }

  return {
    settings,

    /** `undefined` until the user saves a key. */
    async scorer(): Promise<SentimentScorer | undefined> {
      const apiKey = await secrets.get(Secret.DecisionsApiKey);

      if (apiKey === undefined) return undefined;

      const { model, baseURL } = settings();

      return createTypeSafeScorer({ apiKey, model, baseURL });
    },
  };
}

export type Decisions = ReturnType<typeof createDecisions>;
