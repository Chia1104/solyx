import { Button, Tooltip, cn } from "@heroui/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../components/icon.tsx";

import { inWindow } from "./device.ts";
import { useSettingsOpen } from "./settings-open.ts";
import { CategoryDots } from "./symbol-categories.tsx";

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
        className={cn(open && "bg-default")}
        onPress={() => void navigate({ to: "/settings" })}>
        <Icon icon={Settings01Icon} />
      </Button>
      <Tooltip.Content>{t("nav.settings")}</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * The foot of the symbols pane: settings, and while the listings show, the dots that pick the
 * category their lists keep to, centered under them.
 */
export function SymbolsPaneFoot() {
  const settings = useSettingsOpen();

  return (
    <footer className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center">
      <div>{inWindow ? <SettingsButton /> : null}</div>
      {settings ? null : <CategoryDots />}
    </footer>
  );
}
