import { useState } from "react";

import { Popover, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import type { Selection } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Interval, isIntraday } from "@solyx/core/candles";
import { isEnumValue } from "@solyx/utils/is";

import { MenuButton } from "../../components/menu-button.tsx";

import { ChartKind } from "./chart-kind.ts";

type Option = Interval | typeof ChartKind.Session;

// Minute bars, then a day and longer, then the newest session on its own.
const ROWS: Option[][] = [
  Object.values(Interval).filter(isIntraday),
  Object.values(Interval).filter((interval) => !isIntraday(interval)),
  [ChartKind.Session],
];

/** A button naming the bars on screen, which opens every interval and the session view to pick from. */
export function IntervalSelect({
  value,
  kind,
  onChange,
}: {
  value: Interval;
  kind: ChartKind;
  /** An interval picked shows bars of it; the session option shows the newest session. */
  onChange: (next: { interval: Interval; kind: ChartKind }) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const label = t("chart.intervals-label");

  const selected: Option =
    kind === ChartKind.Session ? ChartKind.Session : value;

  const nameOf = (option: Option) =>
    option === ChartKind.Session
      ? t("chart.session")
      : t(`chart.intervals.${option}`);

  const select = (keys: Selection) => {
    if (keys === "all") return;

    const [next] = keys;

    setOpen(false);

    if (next === selected) return;

    if (next === ChartKind.Session) {
      onChange({ interval: value, kind: ChartKind.Session });
    } else if (isEnumValue(Interval, next)) {
      onChange({ interval: next, kind: ChartKind.Candles });
    }
  };

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <MenuButton aria-label={`${label}: ${nameOf(selected)}`}>
        {nameOf(selected)}
      </MenuButton>
      <Popover.Content placement="bottom end" className="w-64">
        <Popover.Dialog aria-label={label} className="flex flex-col gap-2 p-2">
          {ROWS.map((row) => (
            <ToggleButtonGroup
              key={row[0]}
              aria-label={label}
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              fullWidth
              selectedKeys={[selected]}
              onSelectionChange={select}>
              {row.map((option, index) => (
                <ToggleButton key={option} id={option} className="flex-1">
                  {index > 0 ? <ToggleButtonGroup.Separator /> : null}
                  {nameOf(option)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
