import {
  Button,
  Chip,
  Description,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { FubonFile, Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { candlesQueryKeys } from "../market/candles-query.ts";

import { PlanLimits } from "./plan-limits.tsx";
import { SecretFields } from "./secret-fields.tsx";
import { marketDataQuery, settingsQueryKeys } from "./settings-query.ts";

const FUBON_SECRETS = [
  Secret.FubonPersonalId,
  Secret.FubonApiKey,
  Secret.FubonCertPassword,
];

/** What signing in to Fubon takes: the SDK the user downloads, their certificate, ID and API key. */
export function FubonSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(marketDataQuery());

  // Charts sign in again with the new settings.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.marketData }),
      queryClient.invalidateQueries({ queryKey: candlesQueryKeys.all }),
    ]);

  const choose = useMutation({
    mutationFn: (file: FubonFile) =>
      window.solyx.settings.chooseFubonFile(file),
    onSettled: refresh,
  });

  const signIn = useMutation({
    mutationFn: () => window.solyx.settings.signInFubon(),
    onSettled: refresh,
  });

  if (error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data) return <LoadingState />;

  return (
    <div className="flex flex-col gap-6">
      {Object.values(FubonFile).map((file) => (
        <TextField
          key={file}
          isReadOnly
          className="max-w-md"
          value={data.fubon.files[file] ?? ""}>
          <Label>{t(`settings.fubon.files.${file}.label`)}</Label>
          <div className="flex gap-2">
            <Input
              className="grow"
              placeholder={t("settings.fubon.not-chosen")}
            />
            <Button
              variant="secondary"
              isPending={choose.isPending && choose.variables === file}
              isDisabled={choose.isPending}
              onPress={() => choose.mutate(file)}>
              {t("settings.fubon.choose")}
            </Button>
          </div>
          <Description>{t(`settings.fubon.files.${file}.hint`)}</Description>
        </TextField>
      ))}
      {choose.error ? (
        <ErrorAlert
          title={t("settings.market-data.save-failed")}
          description={choose.error.message}
        />
      ) : null}
      <SecretFields secrets={FUBON_SECRETS} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            isPending={signIn.isPending}
            onPress={() => signIn.mutate()}>
            {t("settings.fubon.sign-in")}
          </Button>
          {signIn.isSuccess ? (
            <Chip size="sm" color="success">
              {t("settings.fubon.signed-in", { count: signIn.data })}
            </Chip>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          <PlanLimits plan={data.fubon.plan} />
        </p>
      </div>
      {signIn.error ? (
        <ErrorAlert
          title={t("settings.fubon.sign-in-failed")}
          description={signIn.error.message}
        />
      ) : null}
    </div>
  );
}
