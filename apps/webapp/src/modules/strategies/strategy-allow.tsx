import { useState } from "react";

import { Alert, Button } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { StrategyEntry } from "@solyx/api/strategies";
import type { StrategyReach } from "@solyx/core/strategy";

import { inWindow } from "../../app/device.ts";
import { client } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";

import { StrategyChanges, shortVersion } from "./strategy-changes.tsx";

/**
 * That a strategy's version has not been allowed to run where its code would, with what changed
 * since the one allowed before and the button that allows it, which only this computer's windows
 * offer, since it lets the code run.
 */
export function StrategyAllow({
  strategy,
  reach,
}: {
  strategy: StrategyEntry;
  reach: StrategyReach;
}) {
  const { t } = useTranslation();
  const [reading, setReading] = useState(false);

  const allow = useMutation({
    mutationFn: () =>
      client.strategies.approve({
        name: strategy.name,
        version: strategy.version,
      }),
  });

  return (
    <div className="flex flex-col gap-2">
      <Alert status="warning">
        <Alert.Indicator />
        <Alert.Content className="min-w-0 gap-1">
          <Alert.Title>
            {t("strategies.allow.title", {
              version: shortVersion(strategy.version),
            })}
          </Alert.Title>
          <Alert.Description>
            {reach.sandboxed
              ? t("strategies.allow.sandboxed")
              : t("strategies.allow.outside")}
          </Alert.Description>
        </Alert.Content>
      </Alert>
      {reading ? (
        <StrategyChanges name={strategy.name} version={strategy.version} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="tertiary"
          onPress={() => setReading((open) => !open)}>
          {reading ? t("strategies.allow.hide") : t("strategies.allow.read")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isPending={allow.isPending}
          isDisabled={!inWindow || !reading}
          onPress={() => allow.mutate()}>
          {t("strategies.allow.allow")}
        </Button>
      </div>
      {inWindow ? null : (
        <p className="text-xs text-muted">
          {t("strategies.allow.on-computer")}
        </p>
      )}
      {allow.error ? (
        <ErrorAlert
          title={t("strategies.allow.failed")}
          description={allow.error.message}
        />
      ) : null}
    </div>
  );
}
