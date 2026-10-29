import { Button, Tooltip, cn } from "@heroui/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../components/icon.tsx";
import { BrokerModeChip } from "../modules/account/broker-mode-chip.tsx";
import { MarketSessions } from "../modules/market/market-sessions.tsx";
import { OrderLockToggle } from "../modules/proposals/order-lock.tsx";
import { UpdateAction } from "../modules/updates/update-action.tsx";

import { inWindow } from "./device.ts";
import { useSettingsOpen } from "./settings-open.ts";

const TOOLTIP_DELAY = 600;

function SettingsButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useSettingsOpen();

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("nav.settings")}
        className={cn("ml-auto", open && "bg-default")}
        onPress={() => void navigate({ to: "/settings" })}>
        <Icon icon={Settings01Icon} />
      </Button>
      <Tooltip.Content>{t("nav.settings")}</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * The foot of the symbols pane, under the listings and the settings' sections alike: a waiting
 * update, each market's session, whether orders are paper or real and locked, and the settings.
 */
export function SymbolsPaneFoot() {
  return (
    <footer className="flex shrink-0 flex-col gap-3 px-6 py-3">
      {inWindow ? <UpdateAction /> : null}
      <MarketSessions />
      <div className="flex items-center gap-2">
        <BrokerModeChip />
        {inWindow ? <OrderLockToggle /> : null}
        {inWindow ? <SettingsButton /> : null}
      </div>
    </footer>
  );
}
