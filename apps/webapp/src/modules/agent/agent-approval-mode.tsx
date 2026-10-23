import {
  Button,
  Description,
  Dropdown,
  Header,
  Label,
  cn,
} from "@heroui/react";
import {
  HandIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { ApprovalMode } from "@solyx/agent/wire";
import { isEnumValue } from "@solyx/utils/is";

import { Icon } from "../../components/icon.tsx";
import { useDecisionsReady } from "../settings/settings-query.ts";

const ICONS: Record<ApprovalMode, IconSvgElement> = {
  [ApprovalMode.Ask]: HandIcon,
  [ApprovalMode.Auto]: ShieldCheckIcon,
  [ApprovalMode.Bypass]: ShieldAlertIcon,
};

/**
 * How the conversation's tool calls get allowed, picked from a menu that says what each mode
 * lets through, auto's shell commands only while a decisions model judges them. Running
 * everything unasked is marked as the warning it is, in the menu and on the trigger, so the mode
 * in force is never out of sight.
 */
export function ApprovalModeMenu({
  mode,
  isDisabled,
  onChange,
}: {
  mode: ApprovalMode;
  isDisabled: boolean;
  onChange: (mode: ApprovalMode) => void;
}) {
  const { t } = useTranslation();
  const judged = useDecisionsReady();

  const description = (each: ApprovalMode) =>
    each === ApprovalMode.Auto && !judged
      ? t("agent.approval-mode.auto-unjudged")
      : t(`agent.approval-mode.descriptions.${each}`);

  return (
    <Dropdown>
      <Button
        size="sm"
        variant="ghost"
        isDisabled={isDisabled}
        aria-label={t("agent.approval-mode.label")}
        className={cn(
          "h-7 gap-1.5 px-2 text-xs text-muted",
          mode === ApprovalMode.Bypass && "text-warning"
        )}>
        <Icon icon={ICONS[mode]} className="size-3.5" />
        {t(`agent.approval-mode.modes.${mode}`)}
      </Button>
      <Dropdown.Popover placement="top start" className="w-88">
        <Dropdown.Menu
          aria-label={t("agent.approval-mode.label")}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[mode]}
          onSelectionChange={(keys) => {
            if (keys === "all") return;

            const next = [...keys].find((key) =>
              isEnumValue(ApprovalMode, key)
            );

            if (next && next !== mode) onChange(next);
          }}>
          <Dropdown.Section>
            <Header>{t("agent.approval-mode.label")}</Header>
            {Object.values(ApprovalMode).map((each) => {
              const icon = ICONS[each];
              const warns = each === ApprovalMode.Bypass;

              return (
                <Dropdown.Item
                  key={each}
                  id={each}
                  textValue={t(`agent.approval-mode.modes.${each}`)}>
                  {({ isSelected }) => (
                    <>
                      <div
                        className={cn(
                          "flex h-8 items-start pt-px",
                          warns ? "text-warning" : "text-muted"
                        )}>
                        <Icon icon={icon} className="size-4 shrink-0" />
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <Label className={cn(warns && "text-warning")}>
                          {t(`agent.approval-mode.modes.${each}`)}
                        </Label>
                        <Description className={cn(warns && "text-warning")}>
                          {description(each)}
                        </Description>
                      </div>
                      {isSelected ? (
                        <Icon
                          icon={Tick02Icon}
                          className="ms-auto size-4 shrink-0 self-center"
                        />
                      ) : null}
                    </>
                  )}
                </Dropdown.Item>
              );
            })}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
