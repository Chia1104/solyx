import { Dropdown, Label } from "@heroui/react";

import { MenuButton } from "./menu-button.tsx";

interface Option<Id extends string> {
  id: Id;
  label: string;
}

/**
 * A set of switches folded into a button that says how many are on. Its menu stays open while
 * the user switches them, and `onChange` gets the switched-on ids in `options` order.
 */
export function ToggleMenu<Id extends string>({
  label,
  options,
  selected,
  onChange,
  disallowEmptySelection,
}: {
  label: string;
  options: Option<Id>[];
  selected: NoInfer<Id>[];
  onChange: (selected: Id[]) => void;
  disallowEmptySelection?: boolean;
}) {
  return (
    <Dropdown>
      <MenuButton>
        {label}
        <span className="text-muted tabular-nums">{selected.length}</span>
      </MenuButton>
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
