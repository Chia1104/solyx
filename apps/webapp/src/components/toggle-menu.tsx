import { Dropdown, Label, Tooltip } from "@heroui/react";
import type { IconSvgElement } from "@hugeicons/react";

import { Icon } from "./icon.tsx";
import { MenuButton } from "./menu-button.tsx";

const TOOLTIP_DELAY = 600;

interface Option<Id extends string> {
  id: Id;
  label: string;
}

/**
 * A set of switches folded into a button that shows an icon for them and how many are on. Its
 * menu stays open while the user switches them, and `onChange` gets the switched-on ids in
 * `options` order.
 */
export function ToggleMenu<Id extends string>({
  label,
  icon,
  options,
  selected,
  onChange,
  disallowEmptySelection,
}: {
  label: string;
  icon: IconSvgElement;
  options: Option<Id>[];
  selected: NoInfer<Id>[];
  onChange: (selected: Id[]) => void;
  disallowEmptySelection?: boolean;
}) {
  return (
    <Dropdown>
      <Tooltip delay={TOOLTIP_DELAY}>
        <MenuButton aria-label={label}>
          <Icon icon={icon} />
          <span className="text-muted tabular-nums">{selected.length}</span>
        </MenuButton>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip>
      <Dropdown.Popover placement="bottom start" className="min-w-40">
        <Dropdown.Menu
          aria-label={label}
          selectionMode="multiple"
          disallowEmptySelection={disallowEmptySelection}
          selectedKeys={selected}
          onSelectionChange={(keys) =>
            onChange(
              options
                .filter((option) => keys === "all" || keys.has(option.id))
                .map((option) => option.id)
            )
          }>
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
  );
}
