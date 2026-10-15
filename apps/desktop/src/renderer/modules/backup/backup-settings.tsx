import { useMemo, useState } from "react";

import { Alert, AlertDialog, Button, Switch } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import {
  BackupInterval,
  BackupSetting,
  backupBucketSchema,
  backupPrefixSchema,
  backupRegionSchema,
} from "#shared/backup.ts";
import type { BackupStatus, StoredBackup } from "#shared/backup.ts";
import { Secret } from "#shared/settings.ts";

import { useClock } from "../../app/clock.ts";
import { client, orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { AppSecretRow, SecretsUnavailable } from "../settings/secret-row.tsx";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";
import { secretsQuery } from "../settings/settings-query.ts";
import { TextSettingRow } from "../settings/text-setting-row.tsx";
import { formatBytes } from "../storage/format-bytes.ts";

import {
  backupSettingsQuery,
  backupStatusQuery,
  storedBackupsQuery,
} from "./backup-query.ts";

/** Entered text that must pass the schema the main process saves it under, with a localized message. */
const matching = (schema: z.ZodType<string>, error: string) =>
  z
    .string()
    .trim()
    .refine((value) => schema.safeParse(value).success, { error });

/** The bucket backups go to, the access key that reaches it and the passphrase that seals them. */
function BackupDestination() {
  const { t } = useTranslation();
  const settings = useQuery(backupSettingsQuery());
  const secrets = useQuery(secretsQuery());

  // Rebuilt per language so the field errors come out localized.
  const schemas = useMemo(
    () => ({
      endpoint: matching(
        z.url({ protocol: /^https?$/ }),
        t("settings.backup.destination.endpoint-invalid")
      ),
      region: matching(
        backupRegionSchema,
        t("settings.backup.destination.region-invalid")
      ),
      bucket: matching(
        backupBucketSchema,
        t("settings.backup.destination.bucket-invalid")
      ),
      prefix: matching(
        backupPrefixSchema,
        t("settings.backup.destination.prefix-invalid")
      ),
    }),
    [t]
  );

  const failed = settings.error ?? secrets.error;

  return (
    <Section
      title={t("settings.backup.destination.title")}
      description={t("settings.backup.destination.description")}>
      {failed ? (
        <LoadError
          error={failed}
          onRetry={() => {
            void settings.refetch();
            void secrets.refetch();
          }}
        />
      ) : !settings.data || !secrets.data ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-3">
          {secrets.data.available ? null : <SecretsUnavailable />}
          <SettingsList>
            <TextSettingRow
              label={t("settings.backup.destination.endpoint")}
              description={t(
                "settings.backup.destination.endpoint-description"
              )}
              value={settings.data.endpoint ?? ""}
              isDefault={settings.data.endpoint === null}
              resetLabel={t("settings.backup.destination.endpoint-reset")}
              schema={schemas.endpoint}
              onSave={(next) =>
                client.backup.set({
                  setting: BackupSetting.Endpoint,
                  value: next,
                })
              }
            />
            <TextSettingRow
              label={t("settings.backup.destination.region")}
              description={t("settings.backup.destination.region-description")}
              value={settings.data.region ?? settings.data.defaults.region}
              isDefault={settings.data.region === null}
              schema={schemas.region}
              onSave={(next) =>
                client.backup.set({
                  setting: BackupSetting.Region,
                  value: next,
                })
              }
            />
            <TextSettingRow
              label={t("settings.backup.destination.bucket")}
              description={t("settings.backup.destination.bucket-description")}
              value={settings.data.bucket ?? ""}
              isDefault={settings.data.bucket === null}
              resetLabel={t("settings.backup.destination.bucket-reset")}
              schema={schemas.bucket}
              onSave={(next) =>
                client.backup.set({
                  setting: BackupSetting.Bucket,
                  value: next,
                })
              }
            />
            <TextSettingRow
              label={t("settings.backup.destination.prefix")}
              description={t("settings.backup.destination.prefix-description")}
              value={settings.data.prefix ?? settings.data.defaults.prefix}
              isDefault={settings.data.prefix === null}
              schema={schemas.prefix}
              onSave={(next) =>
                client.backup.set({
                  setting: BackupSetting.Prefix,
                  value: next,
                })
              }
            />
            {[
              Secret.BackupAccessKeyId,
              Secret.BackupSecretAccessKey,
              Secret.BackupPassphrase,
            ].map((secret) => (
              <AppSecretRow
                key={secret}
                secret={secret}
                state={secrets.data.states[secret]}
                available={secrets.data.available}
              />
            ))}
          </SettingsList>
        </div>
      )}
    </Section>
  );
}

/** When backups are made on their own, what the bucket holds of them, and making one now. */
function BackupNow({ status }: { status: BackupStatus }) {
  const { t, i18n } = useTranslation();
  const clock = useClock();
  const queryClient = useQueryClient();
  const settings = useQuery(backupSettingsQuery());

  const automatic = useMutation({
    mutationFn: (on: boolean) => client.backup.setAutomatic(on),
  });

  const every = useMutation({
    mutationFn: (next: BackupInterval) => client.backup.setEvery(next),
  });

  const backUp = useMutation({
    mutationFn: () => client.backup.backUp(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpc.backup.list.key() }),
  });

  const saveFailed = automatic.error ?? every.error;

  return (
    <Section
      title={t("settings.backup.now.title")}
      description={t("settings.backup.now.description")}>
      <div className="flex flex-col gap-3">
        <SettingsList>
          {settings.data ? (
            <>
              <SettingsRow
                label={t("settings.backup.now.automatic")}
                description={t("settings.backup.now.automatic-description")}
                actions={
                  <Switch
                    isSelected={settings.data.automatic}
                    isDisabled={automatic.isPending}
                    onChange={(on) => automatic.mutate(on)}>
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <span className="sr-only">
                        {t("settings.backup.now.automatic")}
                      </span>
                    </Switch.Content>
                  </Switch>
                }
              />
              <SettingsRow
                label={t("settings.backup.now.every")}
                description={t("settings.backup.now.every-description")}
                actions={
                  <OptionSelect
                    aria-label={t("settings.backup.now.every")}
                    className="w-44"
                    value={settings.data.every}
                    isDisabled={!settings.data.automatic || every.isPending}
                    options={Object.values(BackupInterval).map((id) => ({
                      id,
                      label: t(`settings.backup.now.every-options.${id}`),
                    }))}
                    onChange={(next) => every.mutate(next)}
                  />
                }
              />
            </>
          ) : null}
          <SettingsRow
            label={t("settings.backup.now.last")}
            value={
              status.lastBackupAt === null
                ? t("settings.backup.now.never")
                : clock.time(status.lastBackupAt)
            }
          />
          {status.stored ? (
            <SettingsRow
              label={t("settings.backup.now.stored")}
              value={t("settings.backup.now.stored-value", {
                count: status.stored.count,
                size: formatBytes(status.stored.bytes, i18n.language),
              })}
            />
          ) : null}
        </SettingsList>
        {saveFailed ? (
          <ErrorAlert
            title={t("settings.save-failed")}
            description={saveFailed.message}
          />
        ) : null}
        {status.failure === null ? null : (
          <ErrorAlert
            title={t("settings.backup.now.background-failed")}
            description={status.failure}
          />
        )}
        {status.ready ? null : (
          <p className="text-sm text-muted">
            {t("settings.backup.now.not-ready")}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={
              !status.ready || (status.activity !== null && !backUp.isPending)
            }
            isPending={backUp.isPending}
            onPress={() => backUp.mutate()}>
            {t("settings.backup.now.action")}
          </Button>
          {backUp.data ? (
            <span className="text-sm text-muted">
              {t("settings.backup.now.done", {
                size: formatBytes(backUp.data.bytes, i18n.language),
                time: clock.time(backUp.data.createdAt),
              })}
            </span>
          ) : null}
        </div>
        {backUp.error ? (
          <ErrorAlert
            title={t("settings.backup.now.failed")}
            description={backUp.error.message}
          />
        ) : null}
      </div>
    </Section>
  );
}

/** Restoring one backup after a confirmation that says what it replaces. */
function RestoreButton({
  backup,
  isDisabled,
}: {
  backup: StoredBackup;
  isDisabled: boolean;
}) {
  const { t } = useTranslation();
  const clock = useClock();
  const [confirming, setConfirming] = useState(false);

  const restore = useMutation({
    mutationFn: () => client.backup.restore(backup.key),
  });

  return (
    <AlertDialog isOpen={confirming} onOpenChange={setConfirming}>
      <Button size="sm" variant="secondary" isDisabled={isDisabled}>
        {t("settings.backup.restore.action")}
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-100">
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {t("settings.backup.restore.confirm-title", {
                  time: clock.time(backup.createdAt),
                })}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>{t("settings.backup.restore.confirm-body")}</p>
              {restore.error ? (
                <ErrorAlert
                  title={t("settings.backup.restore.failed")}
                  description={restore.error.message}
                />
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                slot="close"
                variant="tertiary"
                isDisabled={restore.isPending}>
                {t("common.cancel")}
              </Button>
              {/* Still pending once it succeeds, since the app is restarting. */}
              <Button
                variant="danger"
                isPending={restore.isPending || restore.isSuccess}
                onPress={() => restore.mutate()}>
                {t("settings.backup.restore.confirm")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

/** The backups in the bucket, read once the user asks, each offered to restore. */
function BackupRestore({
  ready,
  activity,
}: Pick<BackupStatus, "ready" | "activity">) {
  const { t, i18n } = useTranslation();
  const clock = useClock();
  const [shown, setShown] = useState(false);
  const backups = useQuery(storedBackupsQuery(shown && ready));

  return (
    <Section
      title={t("settings.backup.restore.title")}
      description={t("settings.backup.restore.description")}>
      <div className="flex flex-col gap-3">
        <div>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={!ready}
            isPending={backups.isFetching}
            onPress={() => {
              if (shown) void backups.refetch();
              else setShown(true);
            }}>
            {t("settings.backup.restore.show")}
          </Button>
        </div>
        {backups.error ? (
          <LoadError
            error={backups.error}
            onRetry={() => void backups.refetch()}
          />
        ) : !backups.data ? null : backups.data.length === 0 ? (
          <p className="text-sm text-muted">
            {t("settings.backup.restore.empty")}
          </p>
        ) : (
          <SettingsList>
            {backups.data.map((backup) => (
              <SettingsRow
                key={backup.key}
                label={clock.time(backup.createdAt)}
                description={
                  backup.own
                    ? t("settings.backup.restore.own")
                    : t("settings.backup.restore.other")
                }
                value={formatBytes(backup.bytes, i18n.language)}
                actions={
                  <RestoreButton
                    backup={backup}
                    isDisabled={activity !== null}
                  />
                }
              />
            ))}
          </SettingsList>
        )}
      </div>
    </Section>
  );
}

/** Where backups go, making one now, and putting one back in place of what this computer holds. */
export function BackupSettings() {
  const { t } = useTranslation();
  const clock = useClock();
  const { data, error, refetch } = useQuery(backupStatusQuery());

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  return (
    <>
      {data.restoredFrom === null ? null : (
        <RailedColumn className="px-6 pt-5">
          <Alert status="accent">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {t("settings.backup.restored.title", {
                  time: clock.time(data.restoredFrom),
                })}
              </Alert.Title>
              <Alert.Description>
                {t("settings.backup.restored.body")}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        </RailedColumn>
      )}
      <BackupDestination />
      <BackupNow status={data} />
      <BackupRestore ready={data.ready} activity={data.activity} />
    </>
  );
}
