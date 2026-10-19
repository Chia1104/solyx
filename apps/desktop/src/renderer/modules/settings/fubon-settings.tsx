import { Button, buttonVariants, cn } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "#shared/settings-section.ts";
import { FubonFile, FubonSessionState, Secret } from "#shared/settings.ts";
import type { MarketDataStatus } from "#shared/settings.ts";

import { client, orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { PlanLimits } from "./plan-limits.tsx";
import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { secretsQuery } from "./settings-query.ts";

const FUBON_SECRETS = [
  Secret.FubonPersonalId,
  Secret.FubonApiKey,
  Secret.FubonCertPassword,
];

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** How Fubon's sign-in stands, in red once it failed. */
function FubonSessionValue({ status }: { status: MarketDataStatus }) {
  const { t } = useTranslation();
  const { ready, session } = status.fubon;

  const text = !ready
    ? t("settings.fubon.incomplete")
    : session.state === FubonSessionState.SignedIn
      ? t("settings.fubon.signed-in", { count: session.accounts })
      : session.state === FubonSessionState.Failed
        ? t("settings.fubon.sign-in-failed")
        : t("settings.fubon.signed-out");

  return (
    <span
      className={cn(
        ready && session.state === FubonSessionState.Failed && "text-danger"
      )}>
      {text}
    </span>
  );
}

/** What is wrong with the SDK folder chosen: no SDK in it, or a version Solyx was not checked with. */
function SdkNote({
  version,
  tested,
}: {
  version: string | null;
  tested: string[];
}) {
  const { t } = useTranslation();

  if (version === null) {
    return (
      <p className="text-xs text-danger">{t("settings.fubon.sdk-missing")}</p>
    );
  }

  return tested.includes(version) ? null : (
    <p className="text-xs text-warning">
      {t("settings.fubon.sdk-untested", { version, tested: tested.join(", ") })}
    </p>
  );
}

/** Fubon's sign-in as Taiwan's market data reads it, set up under Brokers. */
export function FubonConnectionRow({ status }: { status: MarketDataStatus }) {
  const { t } = useTranslation();

  return (
    <SettingsList>
      <SettingsRow
        label={t("settings.fubon.connection")}
        description={<PlanLimits plan={status.fubon.plan} />}
        value={<FubonSessionValue status={status} />}
        actions={
          <Link
            to="/settings"
            search={{ section: SettingsSection.Brokers }}
            className={buttonVariants({ size: "sm", variant: "secondary" })}>
            {t("settings.market-data.open-brokers")}
          </Link>
        }>
        <p className="text-xs text-muted">
          {t("settings.market-data.fubon-in-brokers")}
        </p>
      </SettingsRow>
    </SettingsList>
  );
}

/**
 * What signing in to Fubon takes, one row each, under the state of the session they sign in,
 * which Taiwan's market data and the order desk share.
 */
export function FubonSettings({ status }: { status: MarketDataStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const secrets = useQuery(secretsQuery());

  // A chosen file joins the read its settings push started; a sign-in changes no setting.
  const refresh = () =>
    queryClient.invalidateQueries(
      { queryKey: orpc.settings.marketData.key() },
      { cancelRefetch: false }
    );

  const choose = useMutation(
    orpc.settings.chooseFubonFile.mutationOptions({ onSettled: refresh })
  );

  const signIn = useMutation({
    mutationFn: () => client.settings.signInFubon(),
    onSettled: refresh,
  });

  if (secrets.error) {
    return (
      <LoadError error={secrets.error} onRetry={() => void secrets.refetch()} />
    );
  }

  if (!secrets.data) return <LoadingState />;

  const { available, states } = secrets.data;
  const { ready, files, plan, session, sdkVersion } = status.fubon;

  return (
    <div className="flex flex-col gap-3">
      {available ? null : <SecretsUnavailable />}
      <SettingsList>
        <SettingsRow
          label={t("settings.fubon.connection")}
          description={<PlanLimits plan={plan} />}
          value={<FubonSessionValue status={status} />}
          actions={
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!ready}
              isPending={signIn.isPending}
              onPress={() => signIn.mutate()}>
              {session.state === FubonSessionState.SignedOut
                ? t("settings.fubon.sign-in")
                : t("settings.fubon.sign-in-again")}
            </Button>
          }>
          {ready && session.state === FubonSessionState.Failed ? (
            <p className="text-xs text-danger">{session.message}</p>
          ) : null}
          {ready && session.state === FubonSessionState.SignedOut ? (
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
          const version = file === FubonFile.Sdk ? sdkVersion : null;

          return (
            <SettingsRow
              key={file}
              label={t(`settings.fubon.files.${file}.label`)}
              description={t(`settings.fubon.files.${file}.hint`)}
              value={
                path ? (
                  <span title={path}>
                    {version === null ? fileName(path) : `fubon-neo ${version}`}
                  </span>
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
              }>
              {file === FubonFile.Sdk && path ? (
                <SdkNote
                  version={version}
                  tested={status.fubon.testedSdkVersions}
                />
              ) : null}
            </SettingsRow>
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
