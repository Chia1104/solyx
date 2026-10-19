import {
  Dropdown,
  Label,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import type { Selection } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import { isEnumValue } from "@solyx/utils/is";

import { MenuButton } from "../../components/menu-button.tsx";

import { ChartKind } from "./chart-kind.ts";

/** Every interval as a button where the main view has room for them, otherwise a menu. */
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

  const label = t("chart.intervals-label");

  const options = [
    ...Object.values(Interval).map((interval) => ({
      id: interval,
      label: t(`chart.intervals.${interval}`),
    })),
    { id: ChartKind.Session, label: t("chart.session") },
  ];

  const selected = kind === ChartKind.Session ? ChartKind.Session : value;

  const select = (keys: Selection) => {
    if (keys === "all") return;

    const [next] = keys;

    if (next === selected) return;

    if (next === ChartKind.Session) {
      onChange({ interval: value, kind: ChartKind.Session });
    } else if (isEnumValue(Interval, next)) {
      onChange({ interval: next, kind: ChartKind.Candles });
    }
  };

  return (
    <>
      <ToggleButtonGroup
        aria-label={label}
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        className="hidden shrink-0 @min-[38rem]/main:flex"
        selectedKeys={[selected]}
        onSelectionChange={select}>
        {options.map((option) => (
          <ToggleButton key={option.id} id={option.id}>
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Dropdown>
        <MenuButton className="@min-[38rem]/main:hidden">
          <span className="sr-only">{label}</span>
          {options.find((option) => option.id === selected)?.label}
        </MenuButton>
        <Dropdown.Popover placement="bottom start" className="min-w-32">
          <Dropdown.Menu
            aria-label={label}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[selected]}
            onSelectionChange={select}>
            {options.map((option) => (
              <Dropdown.Item
                key={option.id}
                id={option.id}
                textValue={option.label}>
                <Dropdown.ItemIndicator />
                <Label>{option.label}</Label>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </>
  );
}
