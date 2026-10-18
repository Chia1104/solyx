import { Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { tradingSettingsQuery } from "../settings/settings-query.ts";

/** The user's lock on every order, which the desk reads at each proposal and confirmation. */
export function OrderLock() {
  const { t } = useTranslation();
  const { data } = useQuery(tradingSettingsQuery());
  const toggle = useMutation(orpc.settings.setOrdersLocked.mutationOptions());

  if (!data) return null;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-separator px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            {t("proposals.lock.label")}
          </span>
          <span className="text-xs text-muted">
            {data.locked ? t("proposals.lock.on") : t("proposals.lock.off")}
          </span>
        </div>
        <Switch
          className="ml-auto"
          isSelected={data.locked}
          isDisabled={toggle.isPending}
          onChange={(locked) => toggle.mutate(locked)}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <span className="sr-only">{t("proposals.lock.label")}</span>
          </Switch.Content>
        </Switch>
      </div>
      {toggle.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={toggle.error.message}
        />
      ) : null}
    </div>
  );
}
