import { ToggleButton, Tooltip, cn } from "@heroui/react";
import {
  SquareLock02Icon,
  SquareUnlock02Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { orpc } from "../../app/rpc.ts";
import { Icon } from "../../components/icon.tsx";
import { tradingSettingsQuery } from "../settings/settings-query.ts";

const TOOLTIP_DELAY = 300;

/**
 * The user's lock on every order, in the status bar so it is one click away from any page; the
 * desk reads it at each proposal and confirmation.
 */
export function OrderLockToggle() {
  const { t } = useTranslation();
  const { data } = useQuery(tradingSettingsQuery());
  const toggle = useMutation(orpc.settings.setOrdersLocked.mutationOptions());

  if (!data) return null;

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <ToggleButton
        isIconOnly
        size="sm"
        aria-label={t("proposals.lock.label")}
        isSelected={data.locked}
        isDisabled={toggle.isPending}
        // As tall as the broker mode's chip beside it.
        className={cn(
          "size-6 min-w-6 rounded-sm",
          data.locked && "bg-warning text-warning-foreground"
        )}
        onChange={(locked) => toggle.mutate(locked)}>
        <Icon
          icon={data.locked ? SquareLock02Icon : SquareUnlock02Icon}
          className="size-3.5"
        />
      </ToggleButton>
      <Tooltip.Content>
        <p className="font-medium">{t("proposals.lock.label")}</p>
        <p className="text-xs">
          {toggle.error
            ? toggle.error.message
            : data.locked
              ? t("proposals.lock.on")
              : t("proposals.lock.off")}
        </p>
      </Tooltip.Content>
    </Tooltip>
  );
}
