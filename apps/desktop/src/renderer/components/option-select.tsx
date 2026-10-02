import { Description, FieldError, Label, ListBox, Select } from "@heroui/react";

interface Option<Id extends string> {
  id: Id;
  label: string;
}

/**
 * A select over a fixed list of options that calls `onChange` only when another one is chosen.
 * Without a visible `label` it needs an `aria-label`.
 */
export function OptionSelect<Id extends string>({
  options,
  value,
  onChange,
  label,
  description,
  errorMessage,
  "aria-label": ariaLabel,
  className,
  isDisabled,
  isRequired,
  disabledKeys,
}: {
  options: Option<Id>[];
  value: NoInfer<Id>;
  onChange: (id: Id) => void;
  label?: string;
  description?: string;
  errorMessage?: string;
  "aria-label"?: string;
  className?: string;
  isDisabled?: boolean;
  isRequired?: boolean;
  disabledKeys?: Id[];
}) {
  return (
    <Select
      aria-label={ariaLabel}
      className={className}
      value={value}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={errorMessage !== undefined}
      disabledKeys={disabledKeys}
      onChange={(key) => {
        const next = options.find((option) => option.id === key);

        if (next && next.id !== value) onChange(next.id);
      }}>
      {label === undefined ? null : <Label>{label}</Label>}
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {description === undefined ? null : (
        <Description>{description}</Description>
      )}
      <FieldError>{errorMessage}</FieldError>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
