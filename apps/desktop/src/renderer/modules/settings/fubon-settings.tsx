import { Button, cn } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { FubonFile, FubonSessionState, Secret } from "#shared/ipc/settings.ts";
import type { MarketDataStatus } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { PlanLimits } from "./plan-limits.tsx";
import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import {
  isMarketDataReady,
  secretsQuery,
  settingsQueryKeys,
} from "./settings-query.ts";

const FUBON_SECRETS = [
  Secret.FubonPersonalId,
  Secret.FubonApiKey,
  Secret.FubonCertPassword,
];

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/**
 * What signing in to Fubon takes, one row each, under the state of the session they sign in.
 * Rendered only while Fubon is the Taiwan source, so the market's readiness is Fubon's.
 */
export function FubonSettings({ status }: { status: MarketDataStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const secrets = useQuery(secretsQuery());

  // A chosen file joins the read its settings push started; a sign-in changes no setting.
  const refresh = () =>
    queryClient.invalidateQueries(
      { queryKey: settingsQueryKeys.marketData },
      { cancelRefetch: false }
    );

  const choose = useMutation({
    mutationFn: (file: FubonFile) =>
      window.solyx.settings.chooseFubonFile(file),
    onSettled: refresh,
  });

  const signIn = useMutation({
    mutationFn: () => window.solyx.settings.signInFubon(),
    onSettled: refresh,
  });

  if (secrets.error) {
    return (
      <LoadError error={secrets.error} onRetry={() => void secrets.refetch()} />
    );
  }

  if (!secrets.data) return <LoadingState />;

  const { available, states } = secrets.data;
  const { files, plan, session } = status.fubon;

  const complete = isMarketDataReady(status);

  const sessionValue = !complete
    ? t("settings.fubon.incomplete")
    : session.state === FubonSessionState.SignedIn
      ? t("settings.fubon.signed-in", { count: session.accounts })
      : session.state === FubonSessionState.Failed
        ? t("settings.fubon.sign-in-failed")
        : t("settings.fubon.signed-out");

  return (
    <div className="flex flex-col gap-3">
      {available ? null : <SecretsUnavailable />}
      <SettingsList>
        <SettingsRow
          label={t("settings.fubon.connection")}
          description={<PlanLimits plan={plan} />}
          value={
            <span
              className={cn(
                complete &&
                  session.state === FubonSessionState.Failed &&
                  "text-danger"
              )}>
              {sessionValue}
            </span>
          }
          actions={
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!complete}
              isPending={signIn.isPending}
              onPress={() => signIn.mutate()}>
              {session.state === FubonSessionState.SignedOut
                ? t("settings.fubon.sign-in")
                : t("settings.fubon.sign-in-again")}
            </Button>
          }>
          {complete && session.state === FubonSessionState.Failed ? (
            <p className="text-xs text-danger">{session.message}</p>
          ) : null}
          {complete && session.state === FubonSessionState.SignedOut ? (
            <p className="text-xs text-muted">
              {t("settings.fubon.signed-out-hint")}
            </p>
          ) : null}
          {/* A failure the session reports already shows above. */}
          {signIn.error && session.state !== FubonSessionState.Failed ? (
            <ErrorAlert
              title={t("settings.fubon.sign-in-failed")}
              description={signIn.error.message}
            />
          ) : null}
        </SettingsRow>
        {Object.values(FubonFile).map((file) => {
          const path = files[file];

          return (
            <SettingsRow
              key={file}
              label={t(`settings.fubon.files.${file}.label`)}
              description={t(`settings.fubon.files.${file}.hint`)}
              value={
                path ? (
                  <span title={path}>{fileName(path)}</span>
                ) : (
                  t("settings.fubon.not-chosen")
                )
              }
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  isPending={choose.isPending && choose.variables === file}
                  isDisabled={choose.isPending}
                  onPress={() => choose.mutate(file)}>
                  {path
                    ? t("settings.fubon.change")
                    : t("settings.fubon.choose")}
                </Button>
              }
            />
          );
        })}
        {FUBON_SECRETS.map((secret) => (
          <AppSecretRow
            key={secret}
            secret={secret}
            state={states[secret]}
            available={available}
            optional={secret === Secret.FubonCertPassword}
          />
        ))}
      </SettingsList>
      {choose.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={choose.error.message}
        />
      ) : null}
    </div>
  );
}
